/**
 * Modo demostración (VITE_DEMO=true): la app completa corre en el navegador con
 * la API simulada (demo/mockApi.ts), cámara y escaneo simulados y datos de
 * ejemplo. Se usa para compartir una vista previa sin servidor. Nunca en producción.
 */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

/** Ruta a un recurso de /public que funciona con base absoluta o relativa. */
export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;
