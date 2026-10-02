# Pendientes antes de publicar

Lo que la app ya deja preparado pero depende de terceros o de decisiones del cliente.
Cada punto indica **dónde** se completa, para no tocar el resto del código.

## 1. SDK de escaneo (NeuroSentinel™ · Shen.AI en marca blanca) — ADAPTADOR LISTO, FALTA EL CONTRATO

El acceso al SDK es por invitación y requiere contrato B2B (pedido enviado; sin respuesta aún). La licencia del
paquete no permite usarlo sin contrato, así que **el SDK no está en el repositorio**. El adaptador está escrito
contra la API real del paquete web 3.x (`@shenai/sdk`) y probado con un SDK simulado.

**Para activarlo, con el contrato vigente:**
1. `npm install --no-save @shenai/sdk@3 && npm run scan:vendor -w @serena/web` (copia el SDK a `apps/web/public/vendor/`, ignorado por git).
2. Build de la web con `VITE_SCAN_PROVIDER=sdk` y `VITE_SCAN_SDK_KEY=<API key del panel de cliente>`.
3. Servidor con `SERENA_AISLAMIENTO_ORIGEN=true` y `SERENA_ESCANEO_CONNECT_SRC=<orígenes de la licencia que informe el proveedor>`.
4. Configuración remota `escaneo.escalaEstresSdk` con el rango del índice de estrés que confirme el proveedor.
   Sin ella el escaneo queda deshabilitado: el estrés decide el nivel de riesgo y el aviso a la guardia.

| Punto | Estado | Dónde |
|---|---|---|
| Adaptador del SDK | **Implementado** (calidad, progreso, métricas, pérdida de señal, resultado, errores) y probado con un SDK simulado | `apps/web/src/scan/sdk-adapter.ts`, `shenai-map.ts`, `apps/web/test/scan-sdk.test.ts` |
| Aislamiento de origen (COOP/COEP) y CSP con WebAssembly | **Implementado**, se activa con `SERENA_AISLAMIENTO_ORIGEN=true` | `apps/server/src/app.ts`, `apps/web/vite.config.ts` |
| Escala del índice de estrés del SDK → 1–5 | **Por confirmar con el proveedor** (no documentada en el paquete) | `config.escaneo.escalaEstresSdk` |
| Escala de `average_signal_quality` | Por confirmar; hoy se acota a 0–1 | `shenai-map.ts` (`calidadGlobal`) |
| Duración | 60 s por defecto: el SDK marca 30 y 45 s como no validadas | `config.escaneo.duracionS` |
| Orígenes de red de la licencia | Por pedir al proveedor (no figuran en el paquete) | `SERENA_ESCANEO_CONNECT_SRC` |
| Peso del SDK (36 MB de WebAssembly) | Primera carga pesada en teléfono y kiosco; el service worker lo cachea en `/vendor` | `apps/web/public/sw.js` |
| **CSP: el SDK 3.1.15 usa `new Function`** (embind de Emscripten) | Con el SDK activo la CSP agrega `'unsafe-eval'` (concesión de seguridad). **Pedir al proveedor una compilación con `-sDYNAMIC_EXECUTION=0`** y quitarla | `apps/server/src/app.ts` |
| Inicialización sin respuesta | Con una clave falsa, sin GPU y sin acceso al servidor de licencias, el motor se detuvo (`Aborted`) sin llamar al callback. El adaptador corta a los 20 s e informa "sin conexión". Repetir con la clave real y la red habilitada para saber la causa | `sdk-adapter.ts` (`INIT_TOPE_MS`) |

**Verificado con el SDK real 3.1.15** (sin clave), en Chromium y con las cabeceras de la app: carga en ~0,9 s, el
aislamiento de origen queda activo y **todas las funciones y enums que usa el adaptador existen en el SDK**.
| Contrato de eventos (`calidad`, `progreso`, `metrica`, `senal_perdida`, `completo`, `error`) | Definido y consumido por la UI | `packages/domain/src/scan.ts` |
| Activación | `VITE_SCAN_PROVIDER=sdk` | `apps/web/src/scan/registry.ts` |
| P1 · ¿Funciona offline con licencia? | Parcial: la licencia se obtiene en línea en el primer uso de cada dispositivo. Falta confirmar el uso posterior sin conexión. Hoy `escaneo.offline=false` | `config.escaneo.offline` |
| P2 · Soporte web y kiosco | Por confirmar. `config.escaneo.disponibleEn` permite apagarlo por contexto | `config.escaneo.disponibleEn` |
| P3 · Cámara y luz en todos los tonos de piel | Umbrales como configuración remota; calibrar en el trial de 30 días | `config.luz` |
| P4 · No se almacenan ni transmiten imágenes | El adaptador apaga el envío de errores a terceros (Sentry), la grabación, la memoria local y la interfaz del SDK, y nunca usa las funciones que envían resultados o imágenes (PDF por email, FHIR, fotos de tensiómetro, textura del rostro). **Igual hay que confirmarlo por escrito** antes de publicar "El video no se guarda" | `sdk-adapter.ts`, `LightStep.tsx`, `Onboarding.tsx` |

Mientras tanto:
- **Producción** usa `ninguno`: el check-in se hace con autorreporte y reacción.
- **Desarrollo** usa `simulado`: valores sintéticos marcados en pantalla como
  "SIMULACIÓN · SIN SDK · VALORES NO REALES". **Nunca usar con personas.**
- La verificación de luz (luminancia sobre el óvalo, contraluz, movimiento y sensor
  de luz ambiente) **sí está implementada** en el dispositivo y no depende del SDK.
  El "rostro centrado" lo informa el SDK: sin SDK se muestra neutro (·).

## 1 bis. Indicadores oculares de somnolencia — IMPLEMENTADO EN MODO REGISTRO, FALTA LA EVALUACIÓN CLÍNICA

Durante el escaneo, MediaPipe Face Landmarker (Google, Apache-2.0) mide en el dispositivo, sobre el mismo video,
**PERCLOS** (proporción del tiempo con ojos cerrados, criterio P80), **parpadeos por minuto**, **duración media del
parpadeo**, **cierres largos** (≥ 500 ms, candidatos a microsueño) y **cabeceos**. Solo se guardan esos números con el
check-in; ninguna imagen se guarda ni se envía. Los cubre el consentimiento de cámara.

**Modo registro:** se guardan pero **no intervienen en el nivel de riesgo ni en el aviso a la guardia** hasta que el
equipo de salud ocupacional (Dra. Karina Viñas) los evalúe. Apagado por defecto; para el piloto:
`SERENA_CONFIG_JSON={"ocular":{"habilitado":true}}`.

| Punto para la evaluación clínica | Estado | Dónde |
|---|---|---|
| Umbral de ojo cerrado (P80 aproximado: EAR < 50 % de la apertura habitual de la persona en esa lectura) | Provisorio | `config.ocular.fraccionCerrado` |
| Cierre largo ≥ 500 ms | Provisorio (criterio frecuente en la literatura) | `config.ocular.cierreLargoMs` |
| Cabeceo (proxy geométrico nariz entre frente y mentón) | Experimental, calibrar | `config.ocular.cabeceoDelta` |
| Validez: rostro ≥ 70 % del tiempo, ≥ 20 s observados, ≥ 15 cuadros/s | Provisorio | `config.ocular.coberturaMin`, `cuadrosMinPorS` |
| Ventana de 60 s: PERCLOS se validó sobre todo en varios minutos y en conducción | **Limitación**: indicador complementario, no diagnóstico | — |
| Rendimiento del equipo: con GPU ~30 cuadros/s; sin GPU ~10 (medido en un entorno sin GPU: ~100 ms por cuadro) | Medir en los teléfonos, tablets y kioscos de la faena | `ResultadoOcular.cuadrosPorS` |
| Umbrales de somnolencia para usar en el nivel de riesgo | **Por definir** con el equipo clínico | `packages/domain/src/levels.ts` (hoy no se usan) |

Verificado en un navegador real con la política de seguridad de la app: el detector carga (~0,4 s) y sobre una foto
de un rostro real da 478 puntos y EAR ≈ 0,21 en ambos ojos (abiertos). El cálculo se prueba con series sintéticas
(`packages/domain/test/ocular.test.ts`).

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
