import * as db from './db.js';
import { download } from './util.js';

export const addNote = (text) => db.put('notes', { text });
export const addTask = (text, due) => db.put('tasks', { text, due: due || null, done: false, notified: false });
export const readTextFile = (file) => new Promise((res, rej) => {
  if (file.size > 2_000_000) return rej(new Error('Arquivo grande demais (máx. 2 MB).'));
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Falha ao ler o arquivo.')); r.readAsText(file);
});
export const makeDoc = (title, body, ext) => download(`${(title || 'documento').replace(/[^\w\-]+/g, '_')}.${ext}`, ext === 'md' ? `# ${title}\n\n${body}\n` : `${title}\n\n${body}\n`);
export const copyText = async (t) => { await navigator.clipboard.writeText(t); };

// Lembretes: só disparam com o app aberto. Retorna as tarefas vencidas notificadas.
export async function checkReminders(onDue) {
  const now = Date.now();
  for (const t of await db.list('tasks', (x) => x.due && !x.done && !x.notified && new Date(x.due).getTime() <= now)) {
    t.notified = true; await db.put('tasks', t); onDue(t);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('NEXORA — lembrete', { body: t.text, icon: '/icons/icon-192.png' });
  }
}

// Comandos de memória interpretados localmente (sem enviar à IA).
export function parseMemoryCommand(text) {
  const m = text.match(/^\s*(?:nexora[,:]?\s*)?(?:lembre-se|lembra|guarde|anote)\s*(?:de\s+)?(?:que\s+)?(.+)$/i);
  return m ? m[1].trim().replace(/[.!]+$/, '') : null;
}
const SENSITIVE = /(senha|password|token|cart[aã]o|cvv|cpf|api[\s_-]?key|chave\s+(?:privada|secreta))/i;
export const looksSensitive = (t) => SENSITIVE.test(t);
