/**
 * Generador mínimo de PDF de texto (A4, Helvetica), sin dependencias. Alcanza para documentos simples como la
 * orden de compra: títulos, párrafos con ajuste de línea y separadores. Usa WinAnsiEncoding, que cubre el español
 * (á, é, ñ, ü, ¿, ¡) y algunos signos (·, —, …); el resto de los caracteres se reemplaza por "?".
 */

export type BloquePdf =
  | { texto: string; tam?: number; negrita?: boolean; /** Espacio adicional antes, en puntos. */ antes?: number }
  | { separador: true };

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;

/** Unicode → byte de WinAnsi para lo que no coincide con Latin-1. */
const WIN_ANSI: Record<string, number> = { '—': 0x97, '–': 0x96, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80 };

function cadenaPdf(texto: string): string {
  let out = '';
  for (const c of texto) {
    const cp = c.codePointAt(0)!;
    const b = WIN_ANSI[c] ?? (cp < 256 ? cp : 0x3f);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
}

/** Ajuste de línea aproximado: Helvetica promedia ~0,5 em por carácter (algo más en negrita). */
function ajustar(texto: string, tam: number, negrita = false): string[] {
  const max = Math.max(10, Math.floor((ANCHO - 2 * MARGEN) / (tam * (negrita ? 0.58 : 0.5))));
  const lineas: string[] = [];
  for (const parrafo of texto.split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/)) {
      if (!palabra) continue;
      if ((actual + ' ' + palabra).trim().length > max && actual) {
        lineas.push(actual);
        actual = palabra;
      } else actual = (actual + ' ' + palabra).trim();
    }
    lineas.push(actual);
  }
  return lineas;
}

export function generarPdf(bloques: BloquePdf[], titulo = 'Documento'): Buffer {
  const paginas: string[] = [];
  let ops: string[] = [];
  let y = ALTO - MARGEN;
  const nuevaPagina = () => {
    paginas.push(ops.join('\n'));
    ops = [];
    y = ALTO - MARGEN;
  };
  for (const b of bloques) {
    if ('separador' in b) {
      y -= 6;
      if (y < MARGEN) nuevaPagina();
      ops.push(`0.6 w ${MARGEN} ${y} m ${ANCHO - MARGEN} ${y} l S`);
      y -= 10;
      continue;
    }
    const tam = b.tam ?? 10;
    y -= b.antes ?? 0;
    for (const linea of ajustar(b.texto, tam, b.negrita)) {
      y -= tam * 1.35;
      if (y < MARGEN) {
        nuevaPagina();
        y -= tam * 1.35;
      }
      ops.push(`BT /${b.negrita ? 'F2' : 'F1'} ${tam} Tf ${MARGEN} ${y.toFixed(1)} Td ${cadenaPdf(linea)} Tj ET`);
    }
  }
  paginas.push(ops.join('\n'));

  // Objetos: 1 catálogo, 2 páginas, 3-4 fuentes, 5 info, luego (página, contenido) por cada página.
  const objetos: string[] = [];
  const idsPaginas = paginas.map((_, i) => 6 + i * 2);
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objetos[5] = `<< /Title ${cadenaPdf(titulo)} /Producer (SERENA) >>`;
  paginas.forEach((contenido, i) => {
    const id = idsPaginas[i]!;
    objetos[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objetos[id + 1] = `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objetos.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objetos.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
