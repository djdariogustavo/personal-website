// Deja el detector de rostro (MediaPipe Face Landmarker, Apache-2.0) en public/vendor/mediapipe para servirlo
// desde el propio origen: el dispositivo no descarga nada de terceros. public/vendor/ está en .gitignore.
// Se ejecuta antes de compilar la web. Si no hay red para bajar el modelo, avisa y sigue: sin modelo, los
// indicadores oculares quedan inactivos y el escaneo funciona igual.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '../public/vendor/mediapipe');
const MODELO_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const origen = join(dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm');
mkdirSync(join(destino, 'wasm'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'])
  copyFileSync(join(origen, f), join(destino, 'wasm', f));

const modelo = join(destino, 'face_landmarker.task');
if (existsSync(modelo) && statSync(modelo).size > 1_000_000) {
  console.info('Detector de rostro listo en public/vendor/mediapipe (modelo ya descargado).');
} else {
  try {
    const r = await fetch(MODELO_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(modelo, Buffer.from(await r.arrayBuffer()));
    console.info('Detector de rostro listo en public/vendor/mediapipe.');
  } catch (e) {
    console.warn(`No se pudo descargar el modelo del detector de rostro (${e.message}). Los indicadores oculares quedan inactivos.`);
  }
}
