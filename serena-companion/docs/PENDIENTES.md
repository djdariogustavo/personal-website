# Pendientes antes de publicar

Lo que la app ya deja preparado pero depende de terceros o de decisiones del cliente.
Cada punto indica **dónde** se completa, para no tocar el resto del código.

## 1. SDK de escaneo (NeuroSentinel™ · Shen.AI en marca blanca) — NO INTEGRADO

| Punto | Estado | Dónde |
|---|---|---|
| Adaptador del SDK | Esqueleto con el contrato completo, sin implementación | `apps/web/src/scan/sdk-adapter.ts` |
| Contrato de eventos (`calidad`, `progreso`, `metrica`, `senal_perdida`, `completo`, `error`) | Definido y consumido por la UI | `packages/domain/src/scan.ts` |
| Activación | `VITE_SCAN_PROVIDER=sdk` | `apps/web/src/scan/registry.ts` |
| P1 · ¿Funciona offline con licencia? | Por confirmar. Hoy `escaneo.offline=false`: sin conexión se ofrece "Escaneo no disponible sin conexión" | `config.escaneo.offline` |
| P2 · Soporte web y kiosco | Por confirmar. `config.escaneo.disponibleEn` permite apagarlo por contexto | `config.escaneo.disponibleEn` |
| P3 · Cámara y luz en todos los tonos de piel | Umbrales como configuración remota; calibrar en el trial de 30 días | `config.luz` |
| P4 · No se almacenan ni transmiten imágenes | **Confirmar por escrito** antes de publicar el sello "El video no se guarda" y el texto del consentimiento | `LightStep.tsx`, `Onboarding.tsx` |

Mientras tanto:
- **Producción** usa `ninguno`: el check-in se hace con autorreporte y reacción.
- **Desarrollo** usa `simulado`: valores sintéticos marcados en pantalla como
  "SIMULACIÓN · SIN SDK · VALORES NO REALES". **Nunca usar con personas.**
- La verificación de luz (luminancia sobre el óvalo, contraluz, movimiento y sensor
  de luz ambiente) **sí está implementada** en el dispositivo y no depende del SDK.
  El "rostro centrado" lo informa el SDK: sin SDK se muestra neutro (·).

## 2. Umbrales clínicos y de luz (trial de 30 días)
- `config.niveles` (bajo / moderado / alto) y `config.luz` son **provisorios**.
- Por seguridad, `autorreportePuedeSerAlto=false`: el autorreporte solo nunca dispara
  el escalamiento automático a la guardia.
- Se sirven desde `GET /api/config` y se pueden cambiar sin redeploy con `SERENA_CONFIG_JSON`.

## 3. Líneas de ayuda y canal de la guardia (PEC)
- Números por país en `config.lineasAyuda` marcados `verificado: false`
  (AR: 911, 135 · CL: 131, *4141). **Validar por faena antes de publicar.**
- Integración con la guardia: webhook firmado `SERENA_GUARD_WEBHOOK_URL`
  (HMAC-SHA256 en `X-Serena-Signature`). Definir el sistema receptor del PEC.

## 4. Envío del segundo factor (SMS)
- `ConsoleMessenger` imprime el código en la consola. Implementar un `Messenger`
  real (proveedor de SMS) en `apps/server/src/notify.ts`.

## 5. Legal y contenido
- Texto completo de la política de privacidad (Ley 25.326 AR y ley vigente en Chile):
  `PolicyPage` en `apps/web/src/screens/Privacy.tsx`.
- Contenido de Recursos: borrador a revisar por salud ocupacional
  (`apps/web/src/screens/resources-content.ts`).
- Revisión del prompt del acompañante y de la lista de expresiones de riesgo
  (`apps/server/src/companion.ts`, `packages/domain/src/risk.ts`) por profesionales.

## 6. Servicio de pago
- Precios de los planes: **de ejemplo**. Definirlos (`SERENA_PLANS_JSON`) y crear los
  precios en Stripe (`STRIPE_PRICE_IDS`).
- Configurar los webhooks en cada proveedor apuntando a
  `https://<dominio>/api/billing/webhooks/stripe` y `.../mercadopago`.
- Facturación fiscal (AFIP / SII) no está incluida: la emite el proveedor o el ERP.

## 7. Operación
- Cambio de contraseña y recuperación de cuenta por la propia persona (hoy la gestiona salud ocupacional).
- Para varias instancias: mover el límite de pedidos (`ratelimit.ts`) y la base a un almacén compartido.
