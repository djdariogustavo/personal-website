# Seguridad y cifrado — SERENA Companion

Estado al commit del punto A12. Describe **lo que el código hace hoy**, incluidos sus límites. Todo lo que
se diga a trabajadores, empresas o autoridades sobre protección de datos tiene que caber en este documento.

---

## 1. Resumen en lenguaje llano

**Lo que podemos afirmar:**

- **Tu empresa no ve tus resultados, tus check-ins ni tus conversaciones.** Solo recibe estadísticas de
  grupo con reglas que impiden identificar a alguien (grupos de 5 o más, categorías de 3 o más, sin
  grupos homogéneos, porcentajes redondeados y ventana semanal fija). Esto lo garantiza el servidor, no
  una pantalla.
- **Los datos sensibles se guardan cifrados** en el servidor: check-ins (incluidas las mediciones
  fisiológicas), conversaciones con el acompañante y ubicación de los pedidos de ayuda. Cada persona tiene
  su propia clave.
- **No se guardan video, imágenes de la cara, audio ni plantillas biométricas.** Del escaneo y de la
  prueba de voz se guardan solo los valores medidos (pulso, respiración, etc.).
  _(El escaneo depende del SDK de terceros, pendiente: hay que confirmarlo por escrito con el proveedor,
  ver `docs/PENDIENTES.md`, P4.)_
- **Las contraseñas no se guardan**, solo una huella (scrypt) que no permite recuperarlas.
- **Cuando alguien pide ayuda**, la guardia recibe nombre, legajo, teléfono y, si se eligió compartirla,
  la ubicación. **Nunca el texto de las conversaciones.** Cada vez queda registrado y la persona lo ve en
  Privacidad ("Tu información se compartió N veces").

**Lo que NO podemos afirmar (y no hay que decir):**

- ❌ "Nadie más que vos puede ver tus datos." Quien opera el servidor de SERENA tiene la clave maestra y,
  técnicamente, podría descifrarlos. No es cifrado "de extremo a extremo": el servidor descifra para
  exportarte tus datos, para que el acompañante responda y para avisar a la guardia.
- ❌ "La conversación no sale de SERENA." Con el acompañante de IA activado, el texto se envía a
  **Anthropic** solo para generar la respuesta (ver §5).
- ❌ "El PIN protege tus datos." El PIN del teléfono **bloquea la pantalla**; no cifra nada (ver §2).
- ❌ "Al borrar tu cuenta, tus datos desaparecen también de los respaldos." Desaparecen de la base; en las
  copias de respaldo siguen hasta que esas copias vencen (ver §4 y §7).

---

## 2. En el teléfono, la computadora o el kiosco

| Qué | Dónde | Cómo se protege | Contra qué protege | Contra qué **no** |
|---|---|---|---|---|
| Check-ins, cola de cambios sin subir, pedidos de ayuda en cola y mensajes sin enviar | IndexedDB `serena-<id>` | AES-GCM 256 con clave generada en el dispositivo como `CryptoKey` **no extraíble**, guardada en la misma base | Otros sitios web (aislamiento de origen del navegador); herramientas que leen los archivos de la base sin el navegador; que un programa copie la clave | Alguien con el dispositivo **desbloqueado** que abra las herramientas de desarrollador de la app: puede **usar** la clave desde ese origen. Tampoco contra un programa malicioso que controle el navegador. |
| Sesión (token) y perfil (nombre, empresa, permisos) | `localStorage` | Sin cifrar. La política de seguridad de contenido (CSP) solo permite scripts propios, lo que reduce el riesgo de robo del token por inyección de código | Otros sitios web | Quien tenga el navegador desbloqueado |
| PIN de desbloqueo (4 dígitos) | `localStorage` | PBKDF2-SHA256, 310 000 iteraciones, sal aleatoria. Tras 5 intentos fallidos se exige volver a ingresar con contraseña y código | Que alguien que agarra el teléfono entre a la app | **No cifra los datos.** Con acceso al almacenamiento, 10 000 combinaciones se prueban en minutos, y el contador de intentos está en el mismo dispositivo. |
| Huella o rostro (opcional) | Autenticador del sistema (WebAuthn) | La biometría **nunca llega a la app ni al servidor**: el sistema operativo solo responde "verificado" | Lo mismo que el PIN | Lo mismo que el PIN |
| Kiosco (tablet compartida) | Memoria | Nada se escribe en disco; al cerrar la sesión no queda nada. La sesión solo puede registrar su check-in y pedir ayuda (no ve historial) | Que la próxima persona vea los datos de la anterior | Alguien que use la tablet **durante** la sesión abierta (cierra a los 5 min sin uso, con aviso 1 min antes) |
| Código del kiosco | `localStorage` de la tablet | Sin cifrar (identifica al equipo, no a una persona). Se revoca desde el panel | — | Quien copie el código puede registrar otra tablet como kiosco de esa empresa hasta que se revoque |
| App para usar sin conexión | Caché del service worker | Solo guarda la app (HTML, JS, logos). **Nunca respuestas de `/api`** | — | — |

Navegación privada o IndexedDB bloqueado: la app trabaja en memoria (no guarda nada al cerrar).

## 3. En tránsito

- HTTPS obligatorio en producción (lo provee el hosting; Cloudflare en el plan). El servidor envía
  `Strict-Transport-Security` (HSTS) y una CSP que solo permite conectarse al propio origen.
- Aviso a la guardia: webhook **HTTPS** firmado con HMAC-SHA256 (`X-Serena-Signature`). En producción el
  servidor **no arranca** sin URL `https://` y sin secreto de firma.
- Webhooks de pago (Mercado Pago, Stripe): se verifica la firma de cada uno y se procesan una sola vez.

## 4. En el servidor

**Cifrado por persona (AES-256-GCM):**

- Clave de cada persona = HKDF-SHA256(clave maestra, id de la persona). IV aleatorio de 96 bits por
  cifrado. El id va como dato autenticado: un texto cifrado no se puede mover a otra persona, y cualquier
  alteración se detecta (`apps/server/test/cifrado.test.ts`).
- **Cifrado:** contenido de los check-ins (ánimo, sueño, mediciones del escaneo, reacción, voz, nota),
  texto de las conversaciones y ubicación de los pedidos de ayuda.

**En claro, a propósito** (se necesita para operar):

| Dato | Por qué |
|---|---|
| Nombre, DNI, legajo, usuario, puesto, teléfono, email | Identidad para el ingreso, el SMS y el aviso a la guardia |
| Nivel de cada check-in (bien / moderado / alto), fecha, día de roster, en turno | Escalar un resultado alto y calcular las estadísticas anónimas sin descifrar |
| Marca de riesgo de cada mensaje del acompañante (no el texto) | Mantener el estado de cuidado |
| Tipo, origen y hora de los pedidos de ayuda | Entrega y reintentos a la guardia |
| Permisos otorgados, dispositivos y sesiones, registro de auditoría | Operar y rendir cuentas |

**Credenciales:** contraseñas y PIN de kiosco con scrypt (N=2^15, r=8, p=1, sal aleatoria). Códigos SMS,
tokens de QR, de kiosco y de "recordar este equipo": solo se guarda su hash SHA-256. Sesiones revocables
en el servidor (cerrar sesión, cambio o restablecimiento de contraseña, baja).

**Límites:**

- **Un PIN de 4 dígitos no resiste un ataque fuera de línea** si se filtrara la base. En línea está
  protegido por el límite de intentos y el bloqueo por persona (5 fallos → 15 min, en cualquier kiosco).
- **Un código SMS de 6 dígitos tampoco resiste fuera de línea**, pero vence a los 5 min (10 min el de
  recuperación) y admite 5 intentos.
- **La base SQLite no está cifrada como archivo:** los datos en claro de la tabla de arriba dependen del
  cifrado de disco del proveedor.
- **La clave maestra y la base conviven en el mismo servidor:** quien obtenga ambas descifra todo. Por eso
  la clave tiene que estar en un gestor de secretos y **nunca en las copias de respaldo** (§7).
- **Borrar una cuenta no la borra de los respaldos.** La clave se vuelve a derivar con la clave maestra y
  el id. La eliminación efectiva en respaldos depende de su vencimiento.

## 5. Terceros que reciben datos

| Tercero | Qué recibe | Cuándo | A confirmar en el contrato (revisión legal) |
|---|---|---|---|
| Anthropic (acompañante de IA) | Últimos 30 mensajes de la conversación, nombre de pila, día de roster y faena | Solo si la IA está configurada (`ANTHROPIC_API_KEY`) y la persona aceptó el acompañante | Retención, uso para entrenamiento, ubicación del procesamiento, transferencia internacional (Ley 25.326, art. 12) |
| Sistema de la guardia de la empresa | Nombre, legajo, teléfono, tipo de aviso, ubicación si se compartió | Solo en un pedido de ayuda o un resultado alto confirmado | Quién accede en la guardia y cuánto lo guardan |
| Proveedor de SMS (Twilio, pendiente A15) | Teléfono y texto del SMS (códigos y avisos de seguridad) | Ingreso, recuperación y cambios de contraseña | Retención de mensajes |
| Mercado Pago / Stripe | Datos de facturación de la **empresa** (nunca datos de salud) | Contratación | — |
| Hosting (Cloudflare, plan) | Todo lo que pasa por el servidor, cifrado en tránsito | Siempre | Ubicación de los datos y subencargados |

## 6. Registros del servidor (logs)

- En **producción** no se escriben códigos SMS, teléfonos ni nombres de quien pide ayuda
  (`apps/server/test/produccion.test.ts`).
- En **desarrollo** sí se escriben (así funcionan la demo y las pruebas).
- El servidor **no arranca en producción** sin canal hacia la guardia (HTTPS con firma) ni proveedor de
  SMS: sin ellos prometería avisos que no llegan o no podría entregar el segundo factor.

## 7. Recomendaciones, en orden de prioridad

1. **Clave maestra en un gestor de secretos** (Cloudflare Secrets al migrar, A22), fuera de la base y de
   los respaldos, con acceso restringido y auditado.
2. **Política de respaldos escrita:** cifrados, sin la clave maestra, con vencimiento corto (propuesta:
   30 días), para que la eliminación de una cuenta sea efectiva en un plazo conocido que se pueda informar.
3. **Rotación de la clave maestra:** el formato `v1.` ya permite versionar. Falta el procedimiento de
   recifrado.
4. **Contrato de procesamiento con Anthropic** y aviso de transferencia internacional (revisión legal,
   A21).
5. **Evaluar** llevar el token de sesión a una cookie `HttpOnly` (hoy en `localStorage`, mitigado por CSP)
   y derivar la clave local del desbloqueo biométrico (WebAuthn PRF), para que el bloqueo del teléfono
   también cifre. Ambas tienen costos en el uso sin conexión: decidir en el piloto.
6. **Prueba de penetración externa** antes de salir de piloto.

## 8. Verificación automática

| Afirmación | Prueba |
|---|---|
| Check-ins, conversaciones y ubicación cifrados en la base | `api.test.ts` (check-ins, chat), `cifrado.test.ts` (ubicación, IV, dato autenticado, alteración) |
| La empresa solo ve estadísticas con control de divulgación | `disclosure.test.ts`, `billing.test.ts` |
| Aislamiento entre personas y alcance del kiosco | `api.test.ts` |
| Contraseñas, códigos y bloqueo del PIN | `password.test.ts`, `pin.test.ts` |
| Producción: sin canales no arranca; sin códigos ni nombres en los registros | `produccion.test.ts` |
| La app no guarda respuestas de `/api` en la caché | Revisión de código (`apps/web/public/sw.js`) |
