/**
 * Alta inicial de la organización y su primera cuenta de administración (ver alta.ts).
 * Uso (en el servidor, p. ej. desde la consola Shell de Render):
 *   npm run alta -w @serena/server -- --organizacion "Velasco Group SRL" --faena "Piloto" --pais AR \
 *     --nombre "Gustavo Velasco" --usuario gvelasco --telefono +5493512023790 [--email persona@dominio]
 * Imprime la contraseña inicial una sola vez; se cambia en el primer ingreso.
 */
import { env } from './env.ts';
import { openDb } from './db.ts';
import { altaInicial } from './alta.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]!;
  if (!k.startsWith('--') || process.argv[i + 1] === undefined) {
    console.error(`Argumento inválido: ${k}. Ver el uso al comienzo de apps/server/src/alta-inicial.ts.`);
    process.exit(1);
  }
  args.set(k.slice(2), process.argv[i + 1]!);
}
const pais = (args.get('pais') ?? 'AR').toUpperCase();
if (pais !== 'AR' && pais !== 'CL') {
  console.error('--pais debe ser AR o CL.');
  process.exit(1);
}

try {
  const r = altaInicial(openDb(env.dbPath), {
    organizacion: args.get('organizacion') ?? '',
    faena: args.get('faena') ?? '',
    pais,
    nombre: args.get('nombre') ?? '',
    usuario: (args.get('usuario') ?? '').toLowerCase(),
    telefono: args.get('telefono') ?? '',
    email: args.get('email') ?? null,
  });
  console.info('Organización y cuenta de administración creadas.');
  console.info(`  Usuario: ${args.get('usuario')!.toLowerCase()}`);
  console.info(`  Contraseña inicial (se muestra una sola vez; se cambia en el primer ingreso): ${r.passwordInicial}`);
  console.info(`  El código del segundo factor llega por SMS al teléfono terminado en …${args.get('telefono')!.slice(-2)}.`);
} catch (e) {
  console.error(`No se pudo completar el alta: ${(e as Error).message}`);
  process.exit(1);
}
