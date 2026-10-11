import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMemoryCommand, looksSensitive } from '../public/js/tools.js';

const mf = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
const sw = fs.readFileSync('public/sw.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('manifest tem campos obrigatórios e ícones existentes', () => {
  assert.equal(mf.name, 'NEXORA AI'); assert.equal(mf.short_name, 'NEXORA'); assert.equal(mf.display, 'standalone');
  assert.equal(mf.theme_color, '#05070D'); assert.ok(mf.start_url && mf.scope);
  const sizes = mf.icons.map((i) => i.sizes); assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(mf.icons.some((i) => i.purpose === 'maskable'));
  for (const i of mf.icons) assert.ok(fs.existsSync('public' + i.src), i.src);
});
test('index.html referencia manifest e é responsivo', () => {
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/); assert.match(html, /name="viewport"/); assert.match(html, /lang="pt-BR"/);
});
test('Service Worker: precache existe, não cacheia /api e tem página offline', () => {
  const list = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => !p.startsWith('/api'));
  for (const p of list) { const f = p === '/' ? 'public/index.html' : 'public' + p; assert.ok(fs.existsSync(f), p); }
  assert.match(sw, /startsWith\('\/api\/'\)/); assert.match(sw, /offline\.html/); assert.match(sw, /SKIP_WAITING/);
});
test('todos os ids usados em app.js existem no HTML', () => {
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  const ids = new Set([...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), 'id ausente: ' + id);
});
test('imports relativos dos módulos resolvem', () => {
  for (const f of fs.readdirSync('public/js')) for (const m of fs.readFileSync('public/js/' + f, 'utf8').matchAll(/from '\.\/([\w.]+)'/g)) assert.ok(fs.existsSync('public/js/' + m[1]), `${f} -> ${m[1]}`);
});
test('comando de memória e detecção de dados sensíveis', () => {
  assert.equal(parseMemoryCommand('Lembre-se de que meu projeto se chama Redcraft.'), 'meu projeto se chama Redcraft');
  assert.equal(parseMemoryCommand('Nexora, guarde que gosto de café'), 'gosto de café');
  assert.equal(parseMemoryCommand('qual é o meu projeto?'), null);
  assert.ok(looksSensitive('minha senha é 123')); assert.ok(!looksSensitive('gosto de café'));
});
