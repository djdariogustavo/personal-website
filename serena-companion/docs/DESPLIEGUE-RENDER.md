# Publicación en Render

SERENA se publica como un único servicio web de Node (API + app) con la base SQLite en un disco persistente.
La configuración está en el Blueprint [`render.yaml`](../../render.yaml), en la raíz del repositorio.

## Qué crea el Blueprint

| Recurso | Valor | Motivo |
|---|---|---|
| Servicio web `serena-app` | Plan **Starter**, región Virginia (EE. UU.) | El plan gratuito no admite disco ni la consola Shell (alta inicial) y se suspende sin uso |
| Disco `serena-datos` | 1 GB en `/var/data` | La base `serena.db` sobrevive a reinicios y despliegues |
| Rama | `claude/app-payment-service-l1dlmn` | Donde está la app hoy; cambiarla al fusionar con `main` |
| Compilación | `npm ci --include=dev && npm run build` | Incluye la web con el SDK de escaneo |
| Verificación de salud | `GET /api/health` | |

Costo de referencia de Render (verificar en su sitio): plan Starter más el disco, del orden de US$ 7–8 por mes.

## Pasos

1. **Render → New → Blueprint**, conectar GitHub y elegir el repositorio `personal-website`. Render lee `render.yaml`.
2. Completar las variables que pide (`sync: false`). Son las mismas del entorno de desarrollo:

   | Variable | Valor |
   |---|---|
   | `SERENA_PUBLIC_URL` | `https://serena-app.onrender.com` (o la URL que asigne Render; se puede corregir después) |
   | `VITE_SCAN_SDK_KEY` | API key de Shen.AI |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Credenciales de Twilio |
   | `TWILIO_VERIFY_SERVICE_SID` | Servicio Verify "SERENA" (códigos) |
   | `TWILIO_MESSAGING_SERVICE_SID` | "SERENA APP - Avisos de seguridad" (avisos sin código) |
   | `RESEND_API_KEY`, `SERENA_ALERTAS_FROM`, `SERENA_ALERTAS_EMAIL` | Avisos por email a operaciones |
   | `SERENA_GUARDIA_TELEFONOS` | Celulares de la guardia, separados por comas (`+549…,+549…`) |
   | `SERENA_GUARDIA_EMAILS` | Casillas de la guardia, separadas por comas |

   `SERENA_MASTER_KEY` y `SERENA_JWT_SECRET` las genera Render.
   **Copiar `SERENA_MASTER_KEY` a un lugar seguro**: sin ella, los datos cifrados de la base no se pueden leer.
3. **Apply.** La primera compilación tarda unos minutos. Al terminar, `https://<servicio>.onrender.com/api/health`
   responde `{"ok":true}`. Si el servidor no arranca, los registros (Logs) dicen qué variable falta.
4. **Alta inicial** (una sola vez), desde la pestaña **Shell** del servicio:

   ```bash
   npm run alta -w @serena/server -- --organizacion "Velasco Group SRL" --faena "Piloto" --pais AR \
     --nombre "Nombre Apellido" --usuario usuario --telefono +549XXXXXXXXXX
   ```

   Imprime la contraseña inicial una sola vez. En el primer ingreso llega un código por SMS y se pide cambiarla.
   Desde **Equipo**, esa cuenta da de alta a las personas que van a usar la app (con su teléfono para el SMS).
5. **Shen.AI:** en el panel del proveedor, restringir la API key al dominio publicado (la clave viaja en la app).
   Si se cambia la clave, hay que volver a desplegar (se incrusta al compilar).

## Canal hacia la guardia

En producción el servidor no arranca sin un canal hacia la guardia. Por defecto, SERENA avisa **directamente por SMS
y email** (`SERENA_GUARDIA_TELEFONOS`, `SERENA_GUARDIA_EMAILS`) con los mismos proveedores que ya usa (Twilio y
Resend): el aviso incluye qué pasó, nombre, legajo, teléfono, ubicación en el mapa y hora, y no pasa por terceros
nuevos. El SMS a la guardia necesita `TWILIO_MESSAGING_SERVICE_SID` (Verify no envía texto libre). Se envía a todos
los destinos a la vez; si ninguno lo acepta, la app se lo dice a la persona y le sugiere la radio.

Para probarlo después de publicar, desde la Shell: `npm run guardia:prueba -w @serena/server` (aviso ficticio
marcado como prueba).

Si la faena tiene un sistema propio, se puede sumar un webhook (`SERENA_GUARD_WEBHOOK_URL` https y
`SERENA_GUARD_WEBHOOK_SECRET`): POST con JSON firmado con HMAC-SHA256 en `X-Serena-Signature`. No usar servicios
públicos de prueba de webhooks, que exponen nombre, teléfono y ubicación a terceros.

## Después de publicar

- Cada push a la rama configurada vuelve a desplegar (con disco no hay despliegue sin corte: unos segundos fuera de línea).
- Copias de seguridad del disco: Render toma instantáneas diarias del disco; verificar la retención del plan.
- Dominio propio (p. ej. `app.serena…`): Settings → Custom Domains; luego actualizar `SERENA_PUBLIC_URL` y la
  restricción de la clave de Shen.AI.
