import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRateLimiter, validateChat, validateQuery, SECURITY_HEADERS } from './security.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.wasm': 'application/wasm' };

const SYSTEM = 'Você é a NEXORA, uma assistente pessoal de IA. Responda sempre em português do Brasil, de forma clara e objetiva. ' +
  'Você não executa comandos no dispositivo do usuário. Não invente fatos nem links; diga quando não souber. ' +
  'Se houver "Memórias do usuário" abaixo, use-as apenas como contexto fornecido pelo usuário.';

export function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const allowedModels = (env.ALLOWED_MODELS || 'claude-sonnet-5-5').split(',').map((s) => s.trim()).filter(Boolean);
  const defaultModel = env.CLAUDE_MODEL || allowedModels[0];
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limiter = createRateLimiter(Number(env.RATE_LIMIT_PER_MIN) || 30);

  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  async function readBody(req, max = 200_000) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) throw new Error('too_large'); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  async function chat(req, res) {
    if (!env.ANTHROPIC_API_KEY) return json(res, 503, { error: 'IA não configurada. Defina ANTHROPIC_API_KEY no servidor.', code: 'not_configured' });
    let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'Requisição inválida.' }); }
    const v = validateChat(body, allowedModels, defaultModel);
    if (v.error) return json(res, 400, { error: v.error });
    const system = v.context ? `${SYSTEM}\n\nMemórias do usuário:\n${v.context}` : SYSTEM;
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    let up;
    try {
      up = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: v.model, max_tokens: 1500, stream: true, system, messages: v.messages })
      });
    } catch { return json(res, 502, { error: 'Não foi possível contatar o provedor de IA.' }); }
    if (!up.ok) { console.error('provider status', up.status); return json(res, 502, { error: 'O provedor de IA recusou a requisição.', status: up.status }); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of up.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'content_block_delta' && ev.delta?.text) res.write(`data: ${JSON.stringify({ t: ev.delta.text })}\n\n`);
            if (ev.type === 'message_stop') res.write('data: {"done":true}\n\n');
            if (ev.type === 'error') res.write('data: {"error":"Erro no provedor."}\n\n');
          } catch { /* ignora bloco malformado */ }
        }
      }
    } catch { if (!res.writableEnded) res.write('data: {"error":"Conexão interrompida."}\n\n'); }
    res.end();
  }

  async function search(req, res, url) {
    if (!env.BRAVE_API_KEY) return json(res, 503, { error: 'Pesquisa não configurada. Defina BRAVE_API_KEY no servidor.', code: 'not_configured' });
    const q = validateQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Consulta inválida.' });
    try {
      const r = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8&search_lang=pt&country=BR`,
        { headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY } });
      if (!r.ok) return json(res, 502, { error: 'O serviço de busca recusou a requisição.' });
      const d = await r.json();
      const results = (d.web?.results || []).slice(0, 8).map((x) => ({ title: String(x.title || ''), url: String(x.url || ''), description: String(x.description || '').replace(/<[^>]+>/g, '') }))
        .filter((x) => /^https?:\/\//.test(x.url));
      json(res, 200, { query: q, results });
    } catch { json(res, 502, { error: 'Falha ao consultar o serviço de busca.' }); }
  }

  function serveStatic(req, res, url) {
    let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Não encontrado'); }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
      res.end(data);
    });
  }

  return http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');
    const origin = req.headers.origin;
    if (isApi && origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      if (!allowedOrigins.includes(origin)) return json(res, 403, { error: 'Origem não permitida.' });
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,x-access-code');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!isApi) return serveStatic(req, res, url);
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });
    if (env.ACCESS_CODE && req.headers['x-access-code'] !== env.ACCESS_CODE) return json(res, 401, { error: 'Código de acesso inválido.', code: 'unauthorized' });
    if (!limiter(req.socket.remoteAddress || 'x')) return json(res, 429, { error: 'Muitas requisições. Aguarde um minuto.' });
    if (url.pathname === '/api/config' && req.method === 'GET')
      return json(res, 200, { ai: !!env.ANTHROPIC_API_KEY, search: !!env.BRAVE_API_KEY, provider: 'anthropic', models: allowedModels, defaultModel });
    if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, res);
    if (url.pathname === '/api/search' && req.method === 'GET') return search(req, res, url);
    json(res, 404, { error: 'Rota não encontrada.' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`NEXORA AI em http://localhost:${port}`));
}
