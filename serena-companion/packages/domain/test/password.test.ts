import { describe, expect, it } from 'vitest';
import { validarPassword } from '../src/index.ts';

describe('política de contraseñas', () => {
  const ctx = ['30.456.789', 'mrodriguez', '04817', 'Matías Rodríguez'];
  it('acepta frases largas sin exigir símbolos', () => {
    expect(validarPassword('mate con tortas fritas', ctx)).toBeNull();
    expect(validarPassword('Turno-noche-en-la-planta', ctx)).toBeNull();
  });
  it('rechaza cortas, comunes, repetitivas y secuencias', () => {
    expect(validarPassword('corta123', ctx)).toBe('corta');
    expect(validarPassword('Password123', ctx)).toBe('comun');
    expect(validarPassword('Argentina2026', ctx)).toBe('comun');
    expect(validarPassword('aaaaaaaaaaaa', ctx)).toBe('repetitiva');
    expect(validarPassword('abababababab', ctx)).toBe('repetitiva');
    expect(validarPassword('abcdefghijkl', ctx)).toBe('repetitiva');
  });
  it('rechaza el DNI, el legajo, el usuario o el nombre, con o sin separadores ni tildes', () => {
    expect(validarPassword('30456789xyzw', ctx)).toBe('datos_personales');
    expect(validarPassword('mrodriguez!!', ctx)).toBe('datos_personales');
    expect(validarPassword('legajo-04817', ctx)).toBe('datos_personales');
    expect(validarPassword('Rodriguez2026', ctx)).toBe('datos_personales');
  });
  it('cuenta caracteres, no bytes', () => {
    expect(validarPassword('ñandú ñandú', ctx)).toBeNull();
  });
});
