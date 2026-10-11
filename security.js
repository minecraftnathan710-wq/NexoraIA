// Validação, limites de requisição e cabeçalhos de segurança.
export function createRateLimiter(limit = 30, windowMs = 60_000, now = () => Date.now()) {
  const hits = new Map();
  return function check(key) {
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) { hits.set(key, arr); return false; }
    arr.push(t); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return true;
  };
}

export const LIMITS = { maxMessages: 40, maxChars: 12_000, maxContext: 4_000, maxQuery: 200 };

export function validateChat(body, allowedModels, defaultModel) {
  if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' };
  const { messages, model, context } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > LIMITS.maxMessages)
    return { error: 'Lista de mensagens inválida.' };
  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string')
      return { error: 'Mensagem inválida.' };
    const content = m.content.trim();
    if (!content || content.length > LIMITS.maxChars) return { error: 'Mensagem vazia ou longa demais.' };
    clean.push({ role: m.role, content });
  }
  if (clean[0].role !== 'user' || clean[clean.length - 1].role !== 'user')
    return { error: 'A conversa deve começar e terminar com mensagem do usuário.' };
  if (model && !allowedModels.includes(model)) return { error: 'Modelo não permitido.' };
  const ctx = typeof context === 'string' ? context.slice(0, LIMITS.maxContext) : '';
  return { messages: clean, model: model || defaultModel, context: ctx };
}

export function validateQuery(q) {
  if (typeof q !== 'string') return null;
  const s = q.trim();
  return s && s.length <= LIMITS.maxQuery ? s : null;
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};
