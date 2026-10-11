// Voz: reconhecimento e síntese usando as APIs reais do navegador (sem gravar áudio).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;
let rec = null, active = false;

export function listen({ lang = 'pt-BR', continuous = false, onInterim, onFinal, onState, onError }) {
  if (!SR) { onError?.('Reconhecimento de voz não suportado neste navegador. Use o teclado.'); return null; }
  stop();
  rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = continuous;
  rec.onstart = () => { active = true; onState?.(true); };
  rec.onend = () => { active = false; onState?.(false); if (continuous && rec?._keep) { try { rec.start(); } catch {} } };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { rec._keep = false; onError?.('Permissão do microfone negada.'); } else if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.('Erro de voz: ' + e.error); };
  rec.onresult = (e) => {
    let interim = '', fin = '';
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
    if (interim) onInterim?.(interim); if (fin) onFinal?.(fin.trim());
  };
  rec._keep = continuous;
  try { rec.start(); } catch (e) { onError?.('Não foi possível iniciar o microfone.'); }
  return rec;
}
export function stop() { if (rec) { rec._keep = false; try { rec.abort(); } catch {} rec = null; active = false; } }
export const isListening = () => active;

export function voices() { return ttsSupported ? speechSynthesis.getVoices() : []; }
export function onVoices(cb) { if (ttsSupported) { speechSynthesis.onvoiceschanged = cb; } }
export function speak(text, { voiceName, rate = 1, volume = 1, lang = 'pt-BR', onEnd } = {}) {
  if (!ttsSupported) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ''));
  u.lang = lang; u.rate = rate; u.volume = volume;
  const v = voices().find((x) => x.name === voiceName); if (v) u.voice = v;
  u.onend = u.onerror = () => onEnd?.();
  speechSynthesis.speak(u); return true;
}
export const stopSpeaking = () => ttsSupported && speechSynthesis.cancel();
