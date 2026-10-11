// Camada IndexedDB. Todos os registros (exceto profiles/settings) levam o campo pid (perfil ativo),
// garantindo separação de dados por perfil neste navegador.
import { uid } from './util.js';
const NAME = 'nexora', VER = 1;
const STORES = ['profiles', 'settings', 'conversations', 'messages', 'memories', 'notes', 'tasks', 'searches'];
const GLOBAL = ['profiles', 'settings'];
let dbp; let pid = 'default';
export const setProfile = (id) => { pid = id; };
export const getProfileId = () => pid;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const run = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode); const out = fn(tx.objectStore(store));
    tx.oncomplete = () => res(out.result ?? out); tx.onerror = () => rej(tx.error);
  });
};
const req = (r) => ({ get result() { return r.result; } });

export async function put(store, rec) {
  if (!rec.id) rec.id = uid();
  if (!GLOBAL.includes(store) && !rec.pid) rec.pid = pid;
  rec.updated = Date.now(); rec.created ||= rec.updated;
  await run(store, 'readwrite', (s) => s.put(rec)); return rec;
}
export const get = (store, id) => run(store, 'readonly', (s) => req(s.get(id)));
export const del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
export async function list(store, filter) {
  const all = await run(store, 'readonly', (s) => req(s.getAll()));
  let r = GLOBAL.includes(store) ? all : all.filter((x) => x.pid === pid);
  if (filter) r = r.filter(filter);
  return r.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export async function clearProfileData() {
  for (const st of STORES.filter((s) => !GLOBAL.includes(s))) for (const r of await list(st)) await del(st, r.id);
}
export async function exportAll() {
  const out = {};
  for (const st of STORES) out[st] = await run(st, 'readonly', (s) => req(s.getAll()));
  for (const p of out.profiles || []) delete p.descriptor; // biometria não é exportada
  return out;
}
export async function wipeEverything() {
  for (const st of STORES) { const all = await run(st, 'readonly', (s) => req(s.getAll())); for (const r of all) await del(st, r.id); }
}
export const getSetting = async (k, d) => (await get('settings', k))?.value ?? d;
export const setSetting = (k, value) => put('settings', { id: k, value });

export async function ensureDefaults() {
  if (!(await get('profiles', 'default'))) await put('profiles', { id: 'default', name: 'Você' });
  if (!(await get('profiles', 'guest'))) await put('profiles', { id: 'guest', name: 'Convidado' });
}
// Busca simples de memórias por palavras
export async function searchMemories(q) {
  const t = q.toLowerCase().trim();
  return list('memories', (m) => !t || m.text.toLowerCase().includes(t));
}
