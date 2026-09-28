# SERENA Companion™

App personal de bienestar del trabajador de **SERENA Centinela** (Velasco Robota · Tecnología Robota Technologies).
Una sola app responsive para cuatro contextos —móvil, tablet, escritorio web y kiosco— con una cuenta
por persona, sincronización offline-first y el principio rector del diseño: **la app cuida; no vigila.**

> Estado: construida completa según el handoff de diseño (`docs/design/`), **salvo el SDK de escaneo**
> (NeuroSentinel™ / Shen.AI en marca blanca), que queda con su slot y contrato listos.
> Incluye el **servicio de pago** para la organización (Stripe, Mercado Pago y una pasarela de prueba).
> Lo que falta confirmar antes de publicar está en [`docs/PENDIENTES.md`](docs/PENDIENTES.md).

## Arranque rápido (desarrollo)

Requisitos: Node.js ≥ 22.9 (usa `node:sqlite`, sin dependencias nativas).

```bash
cd serena-companion
npm install
npm run seed      # datos de ejemplo del brief (Matías R., Mina Los Andes, 28 días de historial)
npm run dev       # API en :8787 + app en http://localhost:5173
```

| Perfil | Ingreso |
|---|---|
| Trabajador | DNI `30.456.789` o usuario `mrodriguez` · contraseña `serena-demo` |
| Kiosco (`/kiosco`) | código de kiosco que imprime `npm run seed` · legajo `04817` + PIN `1234`, o QR `QR-DEMO-04817` |
| Administración | usuario `admin` · contraseña `serena-admin` |

El código del segundo factor se imprime en la consola del servidor y, en desarrollo, también se muestra en pantalla.

**Vista previa sin servidor:** `npm run build:demo -w @serena/web` genera
`apps/web/dist-preview/serena-companion.html`, la app completa con la API simulada en el navegador
(`VITE_DEMO=true`), cámara, escaneo, micrófono, guardia y pagos simulados, y un selector de dispositivo.
Sirve para compartir un enlace de demostración; nunca se usa en producción.

Otros comandos: `npm test` (dominio + API), `npm run typecheck`, `npm run build && npm start`
(el servidor sirve la app compilada desde `apps/web/dist`).

## Arquitectura

```
serena-companion/
├─ packages/domain/   Lógica compartida (TS puro, sin dependencias): roster, clasificación de niveles,
│                     contrato del SDK de escaneo, verificación de luz, detección de riesgo,
│                     resolución de conflictos de sincronización, facturación, configuración remota.
├─ apps/server/       API Express 5 + SQLite (node:sqlite).
│  ├─ routes/         auth · me/consents/devices · sync (check-ins) · companion · emergency · privacy · admin · webhooks
│  ├─ payments/       Interfaz PaymentProvider + Stripe, Mercado Pago y pasarela de prueba
│  ├─ companion.ts    Acompañante con Claude (salida estructurada) + red de seguridad determinística
│  └─ crypto.ts       scrypt, AES-256-GCM con clave por usuario (HKDF)
├─ apps/web/          PWA React 19 + Vite (móvil, tablet, escritorio y kiosco en la misma app)
│  ├─ lib/            API, base local cifrada (IndexedDB + WebCrypto), motor de sincronización,
│  │                  cola de emergencias, bloqueo con PIN/huella, cámara y medición de luz
│  ├─ scan/           Registro del proveedor de escaneo: ninguno · simulado · sdk (pendiente)
│  └─ screens/        Pantallas 6.1–6.16 del brief + administración y facturación
└─ docs/              Handoff de diseño original y pendientes
```

### Decisiones y garantías

- **Privacidad por diseño.** Check-ins, conversaciones y ubicación se guardan cifrados con una clave por
  usuario. La empresa solo accede a estadísticas agregadas con control de divulgación
  (`packages/domain/src/disclosure.ts`): se cuenta por persona y no por check-in, los grupos deben tener al
  menos 5 personas y cada categoría al menos 3 (si no, se fusiona u oculta), no se publican grupos
  homogéneos, los porcentajes se redondean a 5 puntos y la ventana es fija (4 semanas completas, se
  actualiza los lunes) para evitar deducciones por diferencia. Nunca ve nombres ni resultados individuales. Cada escalamiento a la guardia queda auditado y se muestra en Privacidad
  ("Tu información se compartió N veces en los últimos 90 días"). Exportación, borrado y retiro del
  consentimiento (Ley 25.326).
- **Consentimiento granular.** Cada permiso apaga su paso del check-in (ánimo, cámara, reacción), el chat
  o la ubicación. El botón de emergencia funciona siempre.
- **Offline-first.** Todo se escribe primero en la base local cifrada y se encola; la sincronización es
  incremental (cursor) e idempotente (id de mutación). Conflictos: gana la versión más reciente y se
  desempata por dispositivo de origen. El kiosco trabaja solo en memoria y no conserva nada al cerrar.
- **Emergencia.** Id generado en el dispositivo (reintentos sin duplicados), cola con reintento cada 10 s,
  deslizar para enviar (umbral 86 %, accesible por teclado), ubicación solo si se comparte en esa pantalla.
  Solo la guardia recibe el aviso, nunca el supervisor.
- **Resultado alto.** Cuenta de 15 s para conectar con la guardia salvo que la persona elija otra opción.
  Con los umbrales por defecto, el autorreporte solo **no** dispara el escalamiento (evita avisos por un
  toque equivocado) hasta calibrar en el trial.
- **Acompañante.** Claude (`claude-opus-5` por defecto, configurable) con perfil de escucha sin rol
  profesional y respuesta estructurada `{respuesta, riesgo}`. Un detector determinístico de expresiones de
  riesgo corre **antes** del modelo: el estado de cuidado se activa si cualquiera de los dos lo marca, y el
  modelo nunca puede desactivarlo. Si el modelo no está configurado o falla, responde un acompañante
  básico con frases fijas. Se usa `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) para que
  una negativa por política se reintente en el modelo de respaldo.
- **Sesiones.** 2FA por código de 6 dígitos (5 min, 5 intentos), "recordar 30 días" solo en escritorio,
  cierre remoto por dispositivo, cierre por inactividad (5 min tablet/kiosco, 15 min escritorio) y
  bloqueo local con PIN + huella (WebAuthn) en el teléfono.

## Escaneo NeuroSentinel™ (SDK pendiente)

La UI consume solo el contrato `ScanProvider` / `ScanEvent` de `packages/domain/src/scan.ts`
(eventos `calidad`, `progreso`, `metrica`, `senal_perdida`, `completo`, `error`). Para integrar el SDK
se implementa `apps/web/src/scan/sdk-adapter.ts` y se activa con `VITE_SCAN_PROVIDER=sdk`; ninguna
pantalla cambia. Hasta entonces:

- **Producción** (`ninguno`): el escaneo figura como no disponible y el check-in sigue con autorreporte y reacción.
- **Desarrollo** (`simulado`): valores sintéticos, marcados en pantalla como *SIMULACIÓN · SIN SDK · VALORES NO REALES*.

La **verificación de luz** sí está implementada y es independiente del SDK: luminancia media sobre el
óvalo del rostro, detección de contraluz y de movimiento sobre cuadros reducidos en memoria, más el sensor
de luz ambiente donde el navegador lo expone. Con luz insuficiente el botón "Empezar escaneo" queda
desactivado. Los umbrales son configuración remota.

## Servicio de pago

SERENA se contrata **por organización/faena y por puesto activo**. Paga la empresa, nunca el trabajador,
y el módulo de pagos está aislado de los datos individuales (solo conoce organización, plan, puestos y
estado). **El estado del pago nunca bloquea** el botón de emergencia, el escalamiento ni el acceso de cada
persona a sus datos; solo condiciona los reportes agregados y el alta de puestos por encima de lo contratado.

Flujo: el administrador elige plan, proveedor, moneda y puestos → la API crea el checkout en el proveedor →
el proveedor notifica por **webhook firmado** → la suscripción se actualiza de forma **idempotente**
(tabla `payment_events`).

| Proveedor | Moneda | Alta | Webhook |
|---|---|---|---|
| Stripe | USD | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_IDS` | `POST /api/billing/webhooks/stripe` (checkout.session.completed, customer.subscription.*, invoice.payment_failed) |
| Mercado Pago | ARS o CLP | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_CURRENCY` | `POST /api/billing/webhooks/mercadopago` (subscription_preapproval; firma `x-signature` verificada y estado consultado a la API) |
| Pasarela de prueba | USD/ARS/CLP | automática en desarrollo (`SERENA_PAYMENTS_SANDBOX=true` en producción) | `POST /api/billing/webhooks/sandbox` |

Para sumar otro proveedor (dLocal, PayPal, Transbank, …) se implementa `PaymentProvider`
(`apps/server/src/payments/types.ts`) y se registra en `payments/index.ts`. Los **precios de los planes son de
ejemplo** y se reemplazan con `SERENA_PLANS_JSON`.

## Configuración

Todas las variables están documentadas en [`.env.example`](.env.example). En producción son obligatorias
`SERENA_MASTER_KEY` (32 bytes en base64) y `SERENA_JWT_SECRET`. En desarrollo, si faltan, se generan una
vez y se guardan en `data/.dev-keys.json` (ignorado por git).

## Pruebas

`npm test` ejecuta 32 pruebas: dominio (roster, niveles, luz, riesgo, sincronización, patrones) y API
(2FA, kiosco, cierre remoto, sincronización con conflictos y aislamiento entre usuarios, cifrado en
reposo, acompañante y estado de cuidado, emergencia idempotente sin depender del consentimiento ni del
pago, privacidad, flujo de pago completo con webhooks firmados e idempotentes y verificación de firma de
Mercado Pago).
