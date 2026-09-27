import { useSyncExternalStore } from 'react';
import type { DeviceKind } from '@serena/domain';

/**
 * Una sola app responsive: el contexto se deduce del ancho de la ventana y de
 * la ruta (el kiosco vive en /kiosco, a pantalla completa como PWA).
 */

export type Layout = 'mobile' | 'tablet' | 'desktop';

function layoutFor(w: number): Layout {
  if (w < 700) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, () => layoutFor(window.innerWidth));
}

export function isKioskPath(path = window.location.pathname) {
  return path === '/kiosco' || path.startsWith('/kiosco/');
}

/** Tipo de dispositivo que se registra al iniciar sesión. */
export function detectDeviceKind(): DeviceKind {
  if (isKioskPath()) return 'kiosk';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const w = Math.min(window.screen.width, window.screen.height);
  if (coarse && w < 600) return 'mobile';
  if (coarse) return 'tablet';
  return 'desktop';
}

export function describeSystem(): string {
  const ua = navigator.userAgent;
  const os = /Android (\d+)/.exec(ua)?.[0] ?? (/iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Web');
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  return `${os} · ${standalone ? 'App' : br}`;
}

export function defaultDeviceName(kind: DeviceKind, nombreCorto?: string): string {
  switch (kind) {
    case 'mobile':
      return nombreCorto ? `Teléfono de ${nombreCorto}` : 'Teléfono';
    case 'tablet':
      return 'Tablet';
    case 'desktop':
      return /Mac|Windows|Linux/.test(navigator.userAgent) ? 'Computadora' : 'Navegador web';
    case 'kiosk':
      return 'Kiosco';
  }
}
