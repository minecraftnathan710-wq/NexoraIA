import { $, $$, esc, toast, uid, download } from './util.js';
import * as db from './db.js';
import * as ai from './ai.js';
import * as voice from './voice.js';
import * as face from './face.js';
import * as tools from './tools.js';

const S = { cfg: null, convId: null, msgs: [], ctrl: null, code: '', model: '', speak: false, lang: 'pt-BR', voice: '', rate: 1, vol: 1, profile: null, wake: false };
const PAGES = ['home', 'chats', 'memory', 'face', 'tools', 'search', 'settings'];
const setOrb = (st, label) => { $('#orb').className = 'orb ' + st; $('#orbState').textContent = label; };

/* ---------- navegação ---------- */
function go(p) {
  if (!PAGES.includes(p)) p = 'home';
  PAGES.forEach((x) => ($('#page-' + x).hidden = x !== p));
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  history.replaceState(null, '', '?page=' + p);
  if (p !== 'face') { face.stopLoop(); if (face.cameraOn()) camOff(); }
  ({ chats: renderChats, memory: renderMem, tools: renderTools, search: renderHist, settings: renderSettings })[p]?.();
}

/* ---------- status ---------- */
function updateChips() {
  const n = $('#chipNet'); n.textContent = navigator.onLine ? '● online' : '● offline'; n.className = 'chip ' + (navigator.onLine ? 'ok' : 'bad');
  const a = $('#chipAI'); const ok = S.cfg?.ai && navigator.onLine;
  a.textContent = ok ? '● IA conectada' : S.cfg?.offline || !navigator.onLine ? '● IA indisponível (offline)' : S.cfg && !S.cfg.ai ? '● IA não configurada' : '● IA…';
  a.className = 'chip ' + (ok ? 'ok' : 'bad');
  $('#chipCam').textContent = face.cameraOn() ? '📷 ATIVA' : '📷 off'; $('#chipCam').className = 'chip ' + (face.cameraOn() ? 'on' : '');
  $('#chipMic').textContent = voice.isListening() ? '🎤 ATIVO' : '🎤 off'; $('#chipMic').className = 'chip ' + (voice.isListening() ? 'on' : '');
  $('#greeting').textContent = `Olá, ${S.profile?.name || 'Você'}.`;
}
async function loadConfig() { S.cfg = await ai.getConfig(S.code); updateChips(); }

/* ---------- chat ---------- */
function bubble(role, text) {
  const d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text; $('#log').appendChild(d); $('#log').scrollTop = 1e9; return d;
}
async function newConv() {
  S.convId = null; S.msgs = []; $('#log').innerHTML = '';
  bubble('sys', 'Nova conversa. Sem API configurada, ainda é possível salvar memórias e usar as ferramentas.');
}
async function openConv(id) {
  S.convId = id; S.msgs = (await db.list('messages', (m) => m.cid === id)).sort((a, b) => a.created - b.created);
  $('#log').innerHTML = ''; S.msgs.forEach((m) => bubble(m.role, m.content)); go('home');
}
async function persist(role, content) {
  if (!S.convId) S.convId = (await db.put('conversations', { title: content.slice(0, 50) })).id;
  const m = await db.put('messages', { cid: S.convId, role, content }); await db.put('conversations', { ...(await db.get('conversations', S.convId)) });
  return m;
}
async function memoryContext() { return (await db.list('memories')).slice(0, 40).map((m) => '- ' + m.text).join('\n'); }

async function send(textOverride) {
  const text = (textOverride ?? $('#input').value).trim(); if (!text || S.ctrl) return;
  $('#input').value = ''; voice.stopSpeaking();
  bubble('user', text); S.msgs.push(await persist('user', text));
  const mem = tools.parseMemoryCommand(text);
  if (mem) {
    if (tools.looksSensitive(mem) && !confirm('Isto parece conter dado sensível (senha, cartão, token…). Salvar mesmo assim, só neste dispositivo?')) { bubble('sys', 'Não salvei.'); return; }
    await db.put('memories', { text: mem }); const r = 'Informação salva na sua memória.';
    bubble('assistant', r); S.msgs.push(await persist('assistant', r)); return say(r);
  }
  if (!navigator.onLine) {
    const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const hits = (await db.list('memories')).filter((m) => words.some((w) => m.text.toLowerCase().includes(w)));
    bubble('sys', 'Offline: a IA precisa de internet.' + (hits.length ? ' Memórias locais relacionadas:\n' + hits.map((h) => '• ' + h.text).join('\n') : ''));
    return;
  }
  if (S.cfg && !S.cfg.ai) { bubble('sys', 'IA não configurada. Defina ANTHROPIC_API_KEY no servidor (veja README) e reinicie.'); return; }
  S.ctrl = new AbortController(); $('#btnStopGen').hidden = false; $('#btnSend').disabled = true; setOrb('thinking', 'Pensando…');
  const el = bubble('assistant', '…'); let acc = '';
  try {
    const history = S.msgs.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    acc = await ai.streamChat({ messages: history, model: S.model || undefined, context: await memoryContext(), code: S.code, signal: S.ctrl.signal,
      onToken: (t) => { acc += t; el.textContent = acc; $('#log').scrollTop = 1e9; setOrb('speaking', 'Respondendo…'); } });
    if (acc) { S.msgs.push(await persist('assistant', acc)); say(acc); }
  } catch (e) {
    if (e.name === 'AbortError') { el.textContent = (acc || '') + ' [cancelado]'; if (acc) S.msgs.push(await persist('assistant', acc)); }
    else { el.className = 'msg sys'; el.textContent = '⚠ ' + e.message; if (/código de acesso/i.test(e.message)) toast('Informe o código em Configurações.'); }
  } finally { S.ctrl = null; $('#btnStopGen').hidden = true; $('#btnSend').disabled = false; setOrb('idle', 'Pronta.'); }
}
function say(text) {
  if (!S.speak) return;
  voice.speak(text, { voiceName: S.voice, rate: S.rate, volume: S.vol, lang: S.lang, onEnd: () => setOrb('idle', 'Pronta.') }) && setOrb('speaking', 'Falando…');
}
function toggleMic() {
  if (voice.isListening()) { voice.stop(); updateChips(); setOrb('idle', 'Pronta.'); return; }
  if (!voice.sttSupported) { $('#micNote').textContent = 'Reconhecimento de voz não suportado neste navegador — use o teclado.'; return; }
  voice.listen({ lang: S.lang, onInterim: (t) => ($('#input').value = t), onFinal: (t) => { $('#input').value = t; $('#micNote').textContent = 'Revise o texto e toque em Enviar.'; $('#input').focus(); },
    onState: (on) => { updateChips(); setOrb(on ? 'listening' : 'idle', on ? 'Ouvindo…' : 'Pronta.'); }, onError: (m) => toast(m) });
}
function startWake(on) {
  if (!on) { voice.stop(); return updateChips(); }
  if (!voice.sttSupported) { toast('Seu navegador não suporta reconhecimento de voz.'); $('#setWake').checked = false; return; }
  voice.listen({ lang: S.lang, continuous: true, onState: updateChips, onError: (m) => toast(m),
    onFinal: (t) => { const i = t.toLowerCase().indexOf('nexora'); if (i < 0) return; const cmd = t.slice(i + 6).replace(/^[\s,:.-]+/, ''); $('#input').value = cmd; go('home'); $('#input').focus(); toast('Ativada. Revise e envie.'); } });
}

/* ---------- conversas ---------- */
async function renderChats() {
  const cs = await db.list('conversations');
  $('#chatList').innerHTML = cs.length ? cs.map((c) => `<div class="item"><div class="t"><b>${esc(c.title)}</b><div class="muted small">${new Date(c.updated).toLocaleString('pt-BR')}</div></div><button data-open="${c.id}">Abrir</button><button class="danger" data-del="${c.id}">✕</button></div>`).join('') : '<p class="muted">Nenhuma conversa ainda.</p>';
}

/* ---------- memória ---------- */
async function renderMem() {
  const ms = await db.searchMemories($('#memSearch').value);
  $('#memList').innerHTML = ms.length ? ms.map((m) => `<div class="item"><div class="t">${esc(m.text)}</div><button data-edit="${m.id}">✎</button><button class="danger" data-delm="${m.id}">✕</button></div>`).join('') : '<p class="muted">Sem memórias.</p>';
}

/* ---------- rosto ---------- */
const faceMsg = (m) => ($('#faceMsg').textContent = m), faceState = (s) => ($('#faceState').textContent = s);
async function camOn() {
  try { await face.startCamera($('#video')); faceState('Câmera ATIVA'); updateChips(); } catch (e) { faceState('Erro'); faceMsg(e.message); }
}
function camOff() { face.stopCamera($('#video')); faceState('Câmera desligada'); updateChips(); }
async function enroll() {
  if (!face.cameraOn()) return faceMsg('Ligue a câmera primeiro.');
  if (!confirm('Cadastrar seu rosto? Será salvo apenas um vetor numérico neste dispositivo.')) return;
  try { faceState('Detectando'); await face.enroll($('#video'), $('#faceName').value.trim()); faceMsg('Rosto cadastrado.'); faceState('Cadastrado'); await refreshProfile(); }
  catch (e) { faceState('Erro'); faceMsg(e.message); }
}
async function recog() {
  if (!face.cameraOn()) return faceMsg('Ligue a câmera primeiro.');
  if (!(await face.hasFace())) return faceMsg('Nenhum rosto cadastrado.');
  face.startLoop($('#video'), async (r) => {
    faceState(r.state);
    if (r.state === 'Erro') { faceMsg(r.error); face.stopLoop(); }
    else if (r.state === 'Reconhecido') { faceMsg(`Reconhecido: ${r.profile.name}. Isto não é autenticação segura.`); if (S.profile.id !== r.profile.id) await switchProfile(r.profile.id); }
    else if (r.state === 'Desconhecido') { faceMsg('Rosto desconhecido — modo convidado.'); if (S.profile.id !== 'guest') await switchProfile('guest'); }
  });
}

/* ---------- ferramentas ---------- */
async function renderTools() {
  const [ns, ts] = [await db.list('notes'), await db.list('tasks')];
  $('#noteList').innerHTML = ns.map((n) => `<div class="item"><div class="t">${esc(n.text)}</div><button class="danger" data-deln="${n.id}">✕</button></div>`).join('');
  $('#taskList').innerHTML = ts.map((t) => `<div class="item"><label class="t"><input type="checkbox" data-done="${t.id}" ${t.done ? 'checked' : ''}> ${esc(t.text)}${t.due ? `<div class="muted small">⏰ ${new Date(t.due).toLocaleString('pt-BR')}</div>` : ''}</label><button class="danger" data-delt="${t.id}">✕</button></div>`).join('');
}

/* ---------- pesquisa ---------- */
async function doSearch(q) {
  q = q.trim(); if (!q) return; $('#searchQ').value = q; $('#searchRes').innerHTML = ''; $('#searchMsg').textContent = 'Buscando…';
  try {
    const rs = await ai.webSearch(q, S.code); await db.put('searches', { q });
    $('#searchMsg').textContent = rs.length ? 'Resultados do serviço de busca. Não verificados por NEXORA — confira as fontes.' : 'Nenhum resultado.';
    $('#searchRes').innerHTML = rs.map((r) => `<div class="item"><div class="t"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><div class="muted small">${esc(new URL(r.url).hostname)}</div><div>${esc(r.description)}</div></div></div>`).join('');
  } catch (e) { $('#searchMsg').textContent = '⚠ ' + e.message; }
  renderHist();
}
async function renderHist() { $('#searchHist').innerHTML = (await db.list('searches')).slice(0, 15).map((s) => `<div class="item"><div class="t"><a href="#" data-q="${esc(s.q)}">${esc(s.q)}</a></div><button class="danger" data-delq="${s.id}">✕</button></div>`).join(''); }

/* ---------- configurações / perfis ---------- */
function fillVoices() {
  const vs = voice.voices().filter((v) => v.lang.toLowerCase().startsWith(S.lang.slice(0, 2).toLowerCase()));
  $('#setVoice').innerHTML = '<option value="">Padrão</option>' + vs.map((v) => `<option ${v.name === S.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
}
async function renderSettings() {
  const c = S.cfg || {};
  $('#setStatus').textContent = c.offline ? 'Servidor inacessível.' : c.ai ? 'IA ativa no servidor.' : 'IA não configurada (ANTHROPIC_API_KEY ausente).';
  $('#setModel').innerHTML = (c.models || []).map((m) => `<option ${m === (S.model || c.defaultModel) ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('#setCode').value = S.code; $('#setLang').value = S.lang; $('#setRate').value = S.rate; $('#setVol').value = S.vol; $('#setSpeak').checked = S.speak; $('#setWake').checked = S.wake;
  $('#setTheme').value = document.documentElement.dataset.theme || 'dark'; fillVoices();
  const ps = await db.list('profiles');
  $('#profList').innerHTML = ps.map((p) => `<div class="item"><div class="t">${esc(p.name)} ${p.id === S.profile.id ? '✔' : ''}${p.descriptor ? ' 🙂' : ''}</div><button data-prof="${p.id}">Usar</button>${['default', 'guest'].includes(p.id) ? '' : `<button class="danger" data-delp="${p.id}">✕</button>`}</div>`).join('');
}
async function switchProfile(id) {
  await db.setSetting('activeProfile', id); await refreshProfile(id); await newConv(); updateChips();
}
async function refreshProfile(id) {
  const pid = id || (await db.getSetting('activeProfile', 'default')); db.setProfile(pid); S.profile = await db.get('profiles', pid) || await db.get('profiles', 'default'); updateChips();
}
const saveSet = async () => {
  Object.assign(S, { model: $('#setModel').value, code: $('#setCode').value, lang: $('#setLang').value, voice: $('#setVoice').value, rate: +$('#setRate').value, vol: +$('#setVol').value, speak: $('#setSpeak').checked });
  for (const k of ['model', 'code', 'lang', 'voice', 'rate', 'vol', 'speak']) await db.setSetting(k, S[k]);
};

/* ---------- eventos ---------- */
function bind() {
  $('#nav').onclick = (e) => { const b = e.target.closest('button[data-page]'); if (b) go(b.dataset.page); };
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button,a'); if (!t) return; const d = t.dataset;
    if (d.go) go(d.go);
    if (d.open) openConv(d.open);
    if (d.del && confirm('Excluir esta conversa?')) { for (const m of await db.list('messages', (x) => x.cid === d.del)) await db.del('messages', m.id); await db.del('conversations', d.del); if (S.convId === d.del) newConv(); renderChats(); }
    if (d.delm && confirm('Excluir esta memória?')) { await db.del('memories', d.delm); renderMem(); }
    if (d.edit) { const m = await db.get('memories', d.edit); const n = prompt('Editar memória:', m.text); if (n?.trim()) { m.text = n.trim(); await db.put('memories', m); renderMem(); } }
    if (d.deln) { await db.del('notes', d.deln); renderTools(); }
    if (d.delt) { await db.del('tasks', d.delt); renderTools(); }
    if (d.delq) { await db.del('searches', d.delq); renderHist(); }
    if (d.q !== undefined) { e.preventDefault(); doSearch(d.q); }
    if (d.prof) { await switchProfile(d.prof); renderSettings(); }
    if (d.delp && confirm('Excluir este perfil e todos os seus dados?')) { const cur = db.getProfileId(); db.setProfile(d.delp); await db.clearProfileData(); db.setProfile(cur); await db.del('profiles', d.delp); if (S.profile.id === d.delp) await switchProfile('default'); renderSettings(); }
  });
  document.addEventListener('change', async (e) => { if (e.target.dataset.done) { const t = await db.get('tasks', e.target.dataset.done); t.done = e.target.checked; await db.put('tasks', t); } });
  $('#btnSend').onclick = () => send(); $('#btnMic').onclick = toggleMic; $('#btnNew').onclick = newConv;
  $('#btnStopSpeak').onclick = () => { voice.stopSpeaking(); setOrb('idle', 'Pronta.'); }; $('#btnStopGen').onclick = () => S.ctrl?.abort();
  $('#input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  $('#memAdd').onclick = async () => { const v = $('#memNew').value.trim(); if (!v) return; if (tools.looksSensitive(v) && !confirm('Parece conter dado sensível. Salvar mesmo assim?')) return; await db.put('memories', { text: v }); $('#memNew').value = ''; renderMem(); };
  $('#memSearch').oninput = renderMem;
  $('#memExport').onclick = async () => download('nexora-dados.json', JSON.stringify(await db.exportAll(), null, 2), 'application/json');
  $('#expAll').onclick = $('#memExport').onclick;
  $('#memClear').onclick = async () => { if (confirm('Apagar TODAS as conversas, memórias, notas e tarefas do perfil atual?')) { await db.clearProfileData(); await newConv(); renderMem(); toast('Apagado.'); } };
  $('#delAll').onclick = async () => { if (confirm('Excluir TODOS os dados deste navegador (todos os perfis, rosto e configurações)?')) { face.stopCamera($('#video')); await db.wipeEverything(); await db.ensureDefaults(); location.reload(); } };
  $('#camOn').onclick = camOn; $('#camOff').onclick = camOff; $('#faceEnroll').onclick = enroll; $('#faceRecog').onclick = recog;
  $('#faceDel').onclick = async () => { if (confirm('Excluir definitivamente os dados faciais?')) { face.stopLoop(); await face.removeFace(); faceMsg('Dados faciais excluídos.'); faceState('Câmera ' + (face.cameraOn() ? 'ATIVA' : 'desligada')); } };
  $('#noteAdd').onclick = async () => { const v = $('#noteText').value.trim(); if (v) { await tools.addNote(v); $('#noteText').value = ''; renderTools(); } };
  $('#taskAdd').onclick = async () => { const v = $('#taskText').value.trim(); if (v) { await tools.addTask(v, $('#taskDue').value); $('#taskText').value = ''; renderTools(); } };
  let fileText = '';
  $('#fileIn').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { fileText = await tools.readTextFile(f); $('#filePrev').textContent = fileText.slice(0, 3000); } catch (er) { toast(er.message); } };
  $('#fileSum').onclick = () => { if (!fileText) return toast('Escolha um arquivo.'); if (!confirm('Enviar o texto deste arquivo ao provedor de IA para resumir?')) return; go('home'); send('Resuma em português o texto abaixo:\n\n' + fileText.slice(0, 10000)); };
  $('#fileCopy').onclick = () => tools.copyText(fileText).then(() => toast('Copiado.')).catch(() => toast('Cópia não autorizada.'));
  $('#docMd').onclick = () => tools.makeDoc($('#docTitle').value, $('#docBody').value, 'md'); $('#docTxt').onclick = () => tools.makeDoc($('#docTitle').value, $('#docBody').value, 'txt');
  $('#searchGo').onclick = () => doSearch($('#searchQ').value); $('#searchQ').onkeydown = (e) => e.key === 'Enter' && doSearch($('#searchQ').value);
  for (const id of ['setModel', 'setCode', 'setLang', 'setVoice', 'setRate', 'setVol', 'setSpeak']) $('#' + id).onchange = async () => { await saveSet(); if (id === 'setCode') loadConfig(); if (id === 'setLang') fillVoices(); };
  $('#voiceTest').onclick = () => voice.speak('Olá! Eu sou a NEXORA.', { voiceName: S.voice, rate: S.rate, volume: S.vol, lang: S.lang }) || toast('Síntese de voz não suportada.');
  $('#setWake').onchange = async (e) => { if (e.target.checked && !confirm('A escuta contínua usa o microfone enquanto o app estiver aberto, e o áudio pode ser processado pelo serviço de voz do navegador. Ativar?')) { e.target.checked = false; return; } S.wake = e.target.checked; await db.setSetting('wake', S.wake); startWake(S.wake); };
  $('#setTheme').onchange = async (e) => { document.documentElement.dataset.theme = e.target.value; await db.setSetting('theme', e.target.value); };
  $('#setNotif').onclick = async () => toast('Notificações: ' + (('Notification' in window) ? await Notification.requestPermission() : 'não suportadas'));
  $('#profAdd').onclick = async () => { const n = $('#profName').value.trim(); if (n) { await db.put('profiles', { name: n }); $('#profName').value = ''; renderSettings(); } };
  window.addEventListener('online', () => { updateChips(); loadConfig(); }); window.addEventListener('offline', updateChips);
  let dip; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); dip = e; $('#btnInstall').hidden = false; });
  $('#btnInstall').onclick = async () => { dip?.prompt(); dip = null; $('#btnInstall').hidden = true; };
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', function () {
      if (this.state === 'installed' && navigator.serviceWorker.controller) { toast('Nova versão disponível — recarregando…', 4000); this.postMessage?.('SKIP_WAITING'); reg.waiting?.postMessage('SKIP_WAITING'); }
    }));
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  } catch (e) { console.warn('SW falhou', e); }
}

(async function init() {
  bind(); registerSW();
  try { await db.ensureDefaults(); } catch { toast('Armazenamento local indisponível neste navegador.'); }
  const st = async (k, d) => db.getSetting(k, d);
  Object.assign(S, { code: await st('code', ''), model: await st('model', ''), lang: await st('lang', 'pt-BR'), voice: await st('voice', ''), rate: await st('rate', 1), vol: await st('vol', 1), speak: await st('speak', false) });
  document.documentElement.dataset.theme = await st('theme', 'dark');
  await refreshProfile(); voice.onVoices(fillVoices); await newConv(); await loadConfig();
  setInterval(() => tools.checkReminders((t) => toast('⏰ ' + t.text, 8000)), 20000);
  go(new URLSearchParams(location.search).get('page') || 'home');
  // Escuta contínua nunca é retomada automaticamente: exige novo consentimento a cada sessão.
})();
