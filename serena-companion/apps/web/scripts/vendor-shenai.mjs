// Copia el SDK de escaneo (Shen.AI Web SDK) a public/vendor/shenai para servirlo desde el propio origen.
// Requiere el contrato con el proveedor: la licencia del paquete no permite usarlo sin él. El resultado está en
// .gitignore y nunca se versiona.
//
// Uso (con el contrato vigente):
//   npm install --no-save @shenai/sdk@3
//   npm run scan:vendor -w @serena/web
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '../public/vendor/shenai');

let origen;
try {
  origen = dirname(createRequire(import.meta.url).resolve('@shenai/sdk/package.json'));
} catch {
  console.error('No está instalado @shenai/sdk. Con el contrato vigente: npm install --no-save @shenai/sdk@3');
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
