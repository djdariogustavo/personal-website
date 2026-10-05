/**
 * Política de contraseñas (NIST SP 800-63B, §3.1.1): se exige largo y se
 * bloquean contraseñas comunes o derivadas de los datos de la persona, sin
 * reglas de composición (mayúsculas, símbolos) que empujan a patrones
 * predecibles. Se usa igual en el servidor (autoridad) y en la app (aviso).
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Muestra de las contraseñas más usadas en español e inglés (se comparan sin mayúsculas ni separadores). */
const COMUNES = new Set([
  '1234567890', '0123456789', '1111111111', '0000000000', '1234512345', '9876543210', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  'password', 'password1', 'password12', 'password123', 'contrasena', 'contrasena1', 'contrasena123', 'micontrasena',
  'iloveyou', 'teamo', 'teamomucho', 'tequiero', 'administrador', 'administrator', 'bienvenido', 'bienvenida', 'welcome',
  'argentina', 'argentina1', 'chile', 'chilechile', 'bocajuniors', 'riverplate', 'sanlorenzo', 'racingclub', 'colocolo',
  'mineria', 'minero', 'mina', 'serena', 'serenacompanion', 'companion', 'dragon', 'football', 'futbol', 'princesa',
  'qwerty123', 'qwerty1234', 'abc123456', 'abcdefghij', 'superman', 'batman', 'trustno1', 'letmein', 'monkey',
]);

export type PasswordProblema = 'corta' | 'larga' | 'comun' | 'datos_personales' | 'repetitiva';

export const PASSWORD_COPY: Record<PasswordProblema, string> = {
  corta: `Usá al menos ${PASSWORD_MIN} caracteres. Una frase corta es fácil de recordar y difícil de adivinar.`,
  larga: `Usá como máximo ${PASSWORD_MAX} caracteres.`,
  comun: 'Es una contraseña muy usada. Elegí otra.',
  datos_personales: 'No uses tu DNI, legajo, usuario ni tu nombre.',
  repetitiva: 'Evitá repetir el mismo carácter o secuencias como 1234 o abcd.',
};

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Devuelve el primer problema de la contraseña, o null si es aceptable. */
export function validarPassword(pw: string, contexto: Array<string | null | undefined> = []): PasswordProblema | null {
  if ([...pw].length < PASSWORD_MIN) return 'corta';
  if ([...pw].length > PASSWORD_MAX) return 'larga';
  const n = normalizar(pw);
  if (COMUNES.has(n) || COMUNES.has(n.replace(/\d+$/, ''))) return 'comun';
  if (new Set(n).size <= 2) return 'repetitiva';
  const secuencia = [...n].every((c, i, a) => i === 0 || c.charCodeAt(0) - a[i - 1]!.charCodeAt(0) === 1);
  if (secuencia) return 'repetitiva';
  for (const dato of contexto) {
    const d = normalizar(dato ?? '');
    if (d.length >= 4 && n.includes(d)) return 'datos_personales';
    // Cada palabra del nombre ("matias", "rodriguez") cuenta por separado.
    for (const parte of (dato ?? '').split(/\s+/).map(normalizar)) if (parte.length >= 4 && n.includes(parte)) return 'datos_personales';
  }
  return null;
}
