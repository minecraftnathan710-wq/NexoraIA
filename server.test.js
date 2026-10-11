import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../backend/server.js';

async function start(env = {}, fetchImpl) {
  const s = createApp({ env, fetchImpl }); await new Promise((r) => s.listen(0, r));
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}
const post = (b, body, h = {}) => fetch(b + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
const ok = { messages: [{ role: 'user', content: 'oi' }] };

function sse(events) {
  const enc = new TextEncoder();
  return { ok: true, body: (async function* () { for (const e of events) yield enc.encode(`event: x\ndata: ${JSON.stringify(e)}\n\n`); })() };
}

test('serve index, cabeçalhos de segurança e bloqueia path traversal', async () => {
  const s = await start();
  const r = await fetch(s.base + '/'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((await fetch(s.base + '/..%2fpackage.json')).status >= 400);
  assert.equal((await fetch(s.base + '/nao-existe')).status, 404);
  await s.close();
});
test('config e health', async () => {
  const s = await start({ ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual((await (await fetch(s.base + '/api/health')).json()), { ok: true });
  const c = await (await fetch(s.base + '/api/config')).json(); assert.equal(c.ai, true); assert.equal(c.search, false);
  assert.ok(!JSON.stringify(c).includes('"k"')); await s.close();
});
test('chat sem chave retorna 503 claro', async () => {
  const s = await start(); const r = await post(s.base, ok); assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'not_configured'); await s.close();
});
test('chat valida entrada (400)', async () => {
  const s = await start({ ANTHROPIC_API_KEY: 'k' }, async () => assert.fail('não deveria chamar o provedor'));
  assert.equal((await post(s.base, { messages: [] })).status, 400); await s.close();
});
test('chat faz streaming e não vaza a chave', async () => {
  let seen;
  const s = await start({ ANTHROPIC_API_KEY: 'SEGREDO' }, async (url, o) => { seen = { url, o }; return sse([{ type: 'content_block_delta', delta: { text: 'Olá' } }, { type: 'content_block_delta', delta: { text: '!' } }, { type: 'message_stop' }]); });
  const r = await post(s.base, { ...ok, context: '- projeto: Redcraft' }); const t = await r.text();
  assert.match(t, /"t":"Olá"/); assert.match(t, /"done":true/); assert.ok(!t.includes('SEGREDO'));
  assert.equal(seen.o.headers['x-api-key'], 'SEGREDO'); assert.match(JSON.parse(seen.o.body).system, /Redcraft/); await s.close();
});
test('erro do provedor vira 502 sem detalhes internos', async () => {
  const s = await start({ ANTHROPIC_API_KEY: 'k' }, async () => ({ ok: false, status: 401, text: async () => 'detalhe interno' }));
  const r = await post(s.base, ok); assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('detalhe interno')); await s.close();
});
test('falha de rede para o provedor vira 502', async () => {
  const s = await start({ ANTHROPIC_API_KEY: 'k' }, async () => { throw new Error('ECONNRESET'); });
  assert.equal((await post(s.base, ok)).status, 502); await s.close();
});
test('código de acesso, CORS e rate limit', async () => {
  const s = await start({ ACCESS_CODE: 'abc', RATE_LIMIT_PER_MIN: '3' });
  assert.equal((await fetch(s.base + '/api/config')).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'x-access-code': 'abc' } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'x-access-code': 'abc', origin: 'https://evil.example' } })).status, 403);
  let last; for (let i = 0; i < 4; i++) last = (await fetch(s.base + '/api/config', { headers: { 'x-access-code': 'abc' } })).status;
  assert.equal(last, 429); await s.close();
});
test('pesquisa: sem chave 503, com chave retorna só links http(s)', async () => {
  let s = await start(); assert.equal((await fetch(s.base + '/api/search?q=oi')).status, 503); await s.close();
  s = await start({ BRAVE_API_KEY: 'b' }, async () => ({ ok: true, json: async () => ({ web: { results: [{ title: 'A', url: 'https://a.com', description: '<b>x</b>' }, { title: 'B', url: 'javascript:alert(1)' }] } }) }));
  const d = await (await fetch(s.base + '/api/search?q=oi')).json();
  assert.equal(d.results.length, 1); assert.equal(d.results[0].description, 'x');
  assert.equal((await fetch(s.base + '/api/search?q=')).status, 400); await s.close();
});
test('nenhuma chave/segredo aparece nos arquivos públicos', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  for (const f of walk('public').filter((f) => /\.(js|html|webmanifest|css)$/.test(f))) {
    const t = fs.readFileSync(f, 'utf8'); assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}|x-api-key/i.test(t), f);
  }
});
