import { describe, expect, it, vi } from 'vitest';
import type { ScanEvent, ScanListener } from '@serena/domain';
import { MARCO_VERSION, type ModuloEscaneo, type OpcionesModuloEscaneo, type ProveedorEnMarco } from '../src/scan/marco/contrato.ts';
import { MarcoScanProvider, type MarcoCargado } from '../src/scan/marco/proveedor.ts';
import type { DiagnosticoInicio } from '../src/scan/sdk/diagnostico.ts';

/** Módulo falso: registra los pedidos y deja emitir eventos como lo haría el SDK alojado en el marco. */
function marcoFalso(opts: { version?: number; sinModulo?: boolean } = {}) {
  const marcos: Array<{ llamadas: string[]; descartado: boolean; emitir: ScanListener; opciones?: OpcionesModuloEscaneo }> = [];
  const cargar = async (): Promise<MarcoCargado> => {
    const m: (typeof marcos)[number] = { llamadas: [], descartado: false, emitir: () => undefined };
    marcos.push(m);
    const interno: ProveedorEnMarco = {
      id: 'falso',
      availability: async () => (m.llamadas.push('availability'), { disponible: true }),
      mountPreview: async (_c, _s, l) => void (m.llamadas.push('mountPreview'), (m.emitir = l)),
      start: async (_o, l) => void (m.llamadas.push('start'), (m.emitir = l)),
      stop: async () => void m.llamadas.push('stop'),
      liberar: async () => void m.llamadas.push('liberar'),
    };
    const modulo: ModuloEscaneo = { version: opts.version ?? MARCO_VERSION, motor: 'falso', crear: (o) => ((m.opciones = o), interno) };
    return { modulo: opts.sinModulo ? undefined : modulo, descartar: () => void (m.descartado = true) };
  };
  return { marcos, cargar };
}

const OPCIONES = (diag: DiagnosticoInicio[] = []): OpcionesModuloEscaneo => ({ escalaEstres: { min: 0, max: 10 }, credencial: 'k', diagnostico: (d) => diag.push(d) });
const contenedor = {} as HTMLElement;

describe('módulo de escaneo en marco (iframe)', () => {
  it('carga un solo marco para la vista previa y la medición, y le pasa las opciones de la app', async () => {
    const f = marcoFalso();
    const opciones = OPCIONES();
    const p = new MarcoScanProvider(opciones, f.cargar);
    expect(await p.availability({ online: true })).toEqual({ disponible: true });
    await p.mountPreview(contenedor, null, () => undefined);
    await p.start({ duracionS: 60 }, () => undefined);
    expect(f.marcos).toHaveLength(1);
    expect(f.marcos[0]!.llamadas).toEqual(['availability', 'mountPreview', 'start']);
    expect(f.marcos[0]!.opciones).toBe(opciones);
  });

  it('reenvía los eventos como copias: los objetos del marco no quedan referenciados en la app', async () => {
    const f = marcoFalso();
    const eventos: ScanEvent[] = [];
    const p = new MarcoScanProvider(OPCIONES(), f.cargar);
    await p.start({ duracionS: 60 }, (e) => eventos.push(e));
    const original: ScanEvent = { type: 'completo', resultado: { metricas: { pulso: 70, hrv: 50, respiracion: 14, estres: 2 }, calidad: 0.9, duracionS: 60 } };
    f.marcos[0]!.emitir(original);
    expect(eventos).toEqual([original]);
    expect(eventos[0]).not.toBe(original);
  });

  it('después de una medición, detener descarta el marco: el siguiente escaneo usa un SDK nuevo', async () => {
    const f = marcoFalso();
    const p = new MarcoScanProvider(OPCIONES(), f.cargar);
    await p.mountPreview(contenedor, null, () => undefined);
    await p.start({ duracionS: 60 }, () => undefined);
    await p.stop();
    // Primero se apaga el SDK y recién después se quita su marco (quitarlo encendido hizo caer la pestaña).
    await vi.waitFor(() => expect(f.marcos[0]!.llamadas.slice(-2)).toEqual(['stop', 'liberar']));
    expect(f.marcos[0]!.descartado).toBe(false);
    await vi.waitFor(() => expect(f.marcos[0]!.descartado).toBe(true), { timeout: 3000 });
    await p.mountPreview(contenedor, null, () => undefined);
    expect(f.marcos).toHaveLength(2);
    expect(f.marcos[1]!.descartado).toBe(false);
  });

  it('detener después de solo la vista previa conserva el marco (la licencia ya está validada)', async () => {
    const f = marcoFalso();
    const p = new MarcoScanProvider(OPCIONES(), f.cargar);
    await p.mountPreview(contenedor, null, () => undefined);
    await p.stop();
    await p.start({ duracionS: 60 }, () => undefined);
    expect(f.marcos).toHaveLength(1);
    expect(f.marcos[0]!.descartado).toBe(false);
  });

  it('si el SDK informa un error, reintentar descarta ese marco y arranca con uno nuevo', async () => {
    const f = marcoFalso();
    const eventos: ScanEvent[] = [];
    const p = new MarcoScanProvider(OPCIONES(), f.cargar);
    await p.mountPreview(contenedor, null, (e) => eventos.push(e));
    f.marcos[0]!.emitir({ type: 'error', codigo: 'sin_conexion' });
    expect(eventos).toEqual([{ type: 'error', codigo: 'sin_conexion' }]);
    await p.mountPreview(contenedor, null, () => undefined);
    expect(f.marcos).toHaveLength(2);
    await vi.waitFor(() => expect(f.marcos[0]!.descartado).toBe(true), { timeout: 3000 });
    expect(f.marcos[0]!.llamadas).toContain('liberar');
  });

  it('si la página no publica el módulo o es de otra versión, informa el error y no deja a la persona esperando', async () => {
    for (const caso of [{ sinModulo: true }, { version: MARCO_VERSION + 1 }]) {
      const f = marcoFalso(caso);
      const diag: DiagnosticoInicio[] = [];
      const eventos: ScanEvent[] = [];
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const p = new MarcoScanProvider(OPCIONES(diag), f.cargar);
      await p.mountPreview(contenedor, null, (e) => eventos.push(e));
      expect(eventos).toEqual([{ type: 'error', codigo: 'no_soportado' }]);
      expect(diag.map((d) => d.resultado)).toEqual(['MARCO_FALLIDO']);
      expect(f.marcos[0]!.descartado).toBe(true);
      // El siguiente intento vuelve a cargar el marco.
      await p.mountPreview(contenedor, null, () => undefined);
      expect(f.marcos).toHaveLength(2);
      vi.restoreAllMocks();
    }
  });

  it('si el marco no carga, la disponibilidad distingue sin conexión de no soportado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cargar = async (): Promise<MarcoCargado> => {
      throw new Error('el módulo de escaneo no cargó');
    };
    const p = new MarcoScanProvider(OPCIONES(), cargar);
    expect(await p.availability({ online: false })).toEqual({ disponible: false, motivo: 'sin_conexion' });
    expect(await p.availability({ online: true })).toEqual({ disponible: false, motivo: 'no_soportado' });
    vi.restoreAllMocks();
  });
});
