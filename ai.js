// Cliente do backend de IA e de pesquisa. Nenhuma chave é usada aqui.
const headers = (code) => ({ 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) });

export async function getConfig(code) {
  try { const r = await fetch('/api/config', { headers: headers(code) }); if (!r.ok) return { error: r.status }; return await r.json(); }
  catch { return { offline: true }; }
}

// Faz streaming; chama onToken(texto). Retorna o texto completo. Aceita AbortSignal.
export async function streamChat({ messages, model, context, code, signal, onToken }) {
  if (!navigator.onLine) throw new Error('Sem conexão. A conversa com IA precisa de internet.');
  let r;
  try { r = await fetch('/api/chat', { method: 'POST', headers: headers(code), body: JSON.stringify({ messages, model, context }), signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Não foi possível conectar ao servidor.'); }
  if (!r.ok) {
    let msg = `Erro ${r.status}`; try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2);
      try { const ev = JSON.parse(line); if (ev.error) throw new Error(ev.error); if (ev.t) { full += ev.t; onToken?.(ev.t); } } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
    }
  }
  return full;
}

export async function webSearch(q, code) {
  if (!navigator.onLine) throw new Error('Pesquisa online indisponível sem conexão.');
  const r = await fetch('/api/search?q=' + encodeURIComponent(q), { headers: headers(code) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
  return d.results;
}
