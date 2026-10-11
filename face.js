// Reconhecimento facial local com @vladmandic/face-api (MIT). Requer rodar `npm run setup:face`
// para baixar a biblioteca e os modelos reais para public/vendor e public/models.
// Guardamos apenas o descritor (128 números), nunca imagens.
import * as db from './db.js';
let faceapi = null, stream = null, loop = null;
const THRESHOLD = 0.5;

export async function loadLib() {
  if (faceapi) return faceapi;
  await new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/vendor/face-api.js'; s.onload = res;
    s.onerror = () => rej(new Error('Biblioteca facial ausente. Execute: npm run setup:face'));
    document.head.appendChild(s);
  });
  faceapi = window.faceapi;
  try {
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('/models'), faceapi.nets.faceLandmark68Net.loadFromUri('/models'), faceapi.nets.faceRecognitionNet.loadFromUri('/models')]);
  } catch { faceapi = null; throw new Error('Modelos faciais ausentes ou indisponíveis offline. Execute: npm run setup:face'); }
  return faceapi;
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Câmera não disponível (exige HTTPS ou localhost).');
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 }, audio: false }); }
  catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Permissão da câmera negada.' : 'Nenhuma câmera disponível.'); }
  video.srcObject = stream; await video.play(); return true;
}
export function stopCamera(video) {
  clearInterval(loop); loop = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null; if (video) video.srcObject = null;
}
export const cameraOn = () => !!stream;

export async function detect(video) {
  const api = await loadLib();
  return api.detectSingleFace(video, new api.TinyFaceDetectorOptions({ inputSize: 320 })).withFaceLandmarks().withFaceDescriptor();
}

export async function enroll(video, name) {
  const d = await detect(video);
  if (!d) throw new Error('Nenhum rosto detectável. Aproxime-se e melhore a iluminação.');
  const p = await db.get('profiles', 'default');
  await db.put('profiles', { ...p, id: 'default', name: name || p.name, descriptor: Array.from(d.descriptor) });
  return true;
}
export async function removeFace() {
  for (const p of await db.list('profiles')) if (p.descriptor) { delete p.descriptor; await db.put('profiles', p); }
}
export async function hasFace() { return (await db.list('profiles')).some((p) => p.descriptor); }

// Compara com perfis cadastrados. Retorna {state, profile?}. Nunca atribui identidade a quem não está cadastrado.
export async function recognizeOnce(video) {
  const d = await detect(video);
  if (!d) return { state: 'Detectando' };
  const profiles = (await db.list('profiles')).filter((p) => p.descriptor);
  let best = null, dist = 9;
  for (const p of profiles) {
    const x = faceapi.euclideanDistance(d.descriptor, Float32Array.from(p.descriptor));
    if (x < dist) { dist = x; best = p; }
  }
  return dist < THRESHOLD ? { state: 'Reconhecido', profile: best } : { state: 'Desconhecido' };
}
export function startLoop(video, onResult) {
  clearInterval(loop);
  loop = setInterval(async () => { try { onResult(await recognizeOnce(video)); } catch (e) { onResult({ state: 'Erro', error: e.message }); } }, 1000);
}
export const stopLoop = () => { clearInterval(loop); loop = null; };
