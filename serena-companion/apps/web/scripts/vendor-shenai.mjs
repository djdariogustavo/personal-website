// Copia el SDK de escaneo (Shen.AI Web SDK) a public/vendor/shenai para servirlo desde el propio origen.
// El SDK es una dependencia fija del proyecto (@shenai/sdk 3.1.15, la versión probada con el adaptador), con
// licencia comercial bajo el contrato con el proveedor. La copia está en .gitignore y nunca se versiona.
//
// Uso:
//   npm run scan:vendor -w @serena/web     copia siempre
//   node scripts/vendor-shenai.mjs --si-activo   (lo usa `build`) copia solo con VITE_SCAN_PROVIDER=sdk, para no
//                                                 incluir 36 MB en las compilaciones que no usan el SDK
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

const destino = join(aqui, '../public/vendor/shenai');
// Sin el SDK activo no se incluye (y se borra una copia de una compilación anterior con el SDK).
if (process.argv.includes('--si-activo') && process.env.VITE_SCAN_PROVIDER !== 'sdk') {
  rmSync(destino, { recursive: true, force: true });
  process.exit(0);
}

let origen;
try {
  // El paquete no exporta package.json: se ubica por su entrada principal (index.mjs, en la raíz).
  origen = dirname(createRequire(import.meta.url).resolve('@shenai/sdk'));
} catch {
  console.error('No está instalado @shenai/sdk: correr npm install en serena-companion.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(origen, 'package.json'), 'utf8'));
if (!version.startsWith('3.')) console.warn(`Atención: el adaptador está escrito para la versión 3.x del SDK (instalada: ${version}).`);

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const f of ['index.mjs', 'shenai_sdk.mjs', 'shenai_sdk.wasm', 'util', 'enums', 'LICENSE.md']) {
  if (existsSync(join(origen, f))) cpSync(join(origen, f), join(destino, f), { recursive: true });
}
console.info(`SDK ${version} copiado a ${destino}. Se sirve en /vendor/shenai/index.mjs.`);
