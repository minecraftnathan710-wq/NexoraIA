import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, validateQuery, createRateLimiter } from '../backend/security.js';

const M = ['claude-sonnet-5-5'];
test('validateChat aceita conversa válida', () => {
  const v = validateChat({ messages: [{ role: 'user', content: 'oi' }] }, M, M[0]);
  assert.equal(v.model, M[0]); assert.equal(v.messages.length, 1);
});
test('validateChat rejeita entradas inválidas', () => {
  for (const b of [null, {}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'assistant', content: 'x' }] },
    { messages: [{ role: 'user', content: '' }] }, { messages: [{ role: 'user', content: 'a'.repeat(20000) }] },
    { messages: [{ role: 'user', content: 'a' }], model: 'outro' }])
    assert.ok(validateChat(b, M, M[0]).error, JSON.stringify(b).slice(0, 60));
});
test('contexto é truncado', () => {
  assert.equal(validateChat({ messages: [{ role: 'user', content: 'a' }], context: 'x'.repeat(9000) }, M, M[0]).context.length, 4000);
});
test('validateQuery', () => { assert.equal(validateQuery('  oi '), 'oi'); assert.equal(validateQuery(''), null); assert.equal(validateQuery('x'.repeat(300)), null); assert.equal(validateQuery(5), null); });
test('rate limiter bloqueia e libera após a janela', () => {
  let t = 0; const c = createRateLimiter(2, 1000, () => t);
  assert.ok(c('a')); assert.ok(c('a')); assert.ok(!c('a')); assert.ok(c('b')); t = 1500; assert.ok(c('a'));
});
