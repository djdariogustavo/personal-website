/**
 * Empaqueta la vista previa (dist-demo) como una sola página HTML con el JS y
 * el CSS en línea, lista para publicarse como enlace de demostración. Las
 * imágenes quedan como archivos en assets/.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist-demo/', import.meta.url).pathname;
const out = new URL('../dist-preview/', import.meta.url).pathname;
mkdirSync(join(out, 'assets'), { recursive: true });
const files = readdirSync(join(dist, 'assets'));
const js = files.filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`Se esperaba un solo bundle JS, hay ${js.length}`);
const css = files.find((f) => f.endsWith('.css'));
const code = readFileSync(join(dist, 'assets', js[0]), 'utf8').replaceAll('</script', '<\\/script');
const style = css ? readFileSync(join(dist, 'assets', css), 'utf8') : '';
for (const f of files.filter((f) => f.endsWith('.png'))) copyFileSync(join(dist, 'assets', f), join(out, 'assets', f));
const page = `<title>SERENA Companion</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<meta name="theme-color" content="#010147">
<style>${style}</style>
<div id="root"></div>
<script type="module">${code}</script>
`;
writeFileSync(join(out, 'serena-companion.html'), page);
console.log(`Vista previa: ${join(out, 'serena-companion.html')} (${Math.round(page.length / 1024)} KB)`);
