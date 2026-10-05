# SERENA Companion™ — Prompt para Claude Design

> Vista previa de la aplicación personal del sistema SERENA Centinela.
> Velasco Robota · Tecnología Robota Technologies · Septiembre de 2026
> **El logo se adjunta en la caja de prompt: usalo en el splash, el encabezado y la pantalla de login, sobre fondo oscuro.**

---

## 1. Qué tenés que diseñar

Diseñá una vista previa navegable de **SERENA Companion™**, la aplicación personal de bienestar del trabajador de SERENA Centinela. Es **una sola aplicación responsive** que corre en cuatro contextos:

| Contexto | Dispositivo | Frame de referencia | Uso típico |
|---|---|---|---|
| Móvil | Teléfono Android/iOS con cámara frontal | 390 × 844 | Check-in en el turno, acompañante, botón de emergencia |
| Tablet | Tablet industrial Android 10+, horizontal | 1194 × 834 | Faenas chicas, sala de descanso, check-in compartido |
| Kiosco | Tablet o pantalla táctil fija en acceso o campamento | 1080 × 1920 vertical | Autoservicio al inicio y cierre de turno, sesión efímera |
| Web escritorio | Laptop o PC con webcam | 1440 × 900 | En casa, durante los días de descanso del roster |

Mostrá cada pantalla clave en **móvil y escritorio**, y agregá las pantallas de **kiosco** del punto 6.16. En tablet usá el layout de escritorio con barra lateral colapsada.

El trabajador usa **la misma cuenta en todos sus dispositivos**. Un minero hace su check-in en la tablet del campamento el día 12 del roster y, ya en su casa, abre la web y ve el mismo historial, la misma conversación con el acompañante y el mismo progreso.

---

## 2. Principio de diseño

**La app cuida; no vigila.** Cada pantalla tiene que transmitir tres cosas: esto es tuyo, esto es voluntario, acá nadie te juzga.

- Tono cálido, adulto y directo. Voseo rioplatense ("¿Cómo estás hoy?", "Tomate un minuto").
- Nunca lenguaje clínico ni de diagnóstico en la interfaz del trabajador. Nada de "patología", "trastorno", "paciente".
- Nunca dramatizar. Mostrar la ayuda, no el problema.
- Los datos le pertenecen al trabajador. Su empresa nunca ve resultados individuales, y la interfaz lo recuerda en los momentos sensibles (antes del escaneo, en el resultado, en el chat).
- Pensado para gente cansada: botones grandes, una acción principal por pantalla, textos cortos, lectura en menos de 5 segundos.

---

## 3. Identidad visual

Usá exactamente estos tokens. Son los del sitio de SERENA Centinela.

### Colores

| Token | Hex | Uso |
|---|---|---|
| `--c-bg` | `#010147` | Fondo principal (azul noche SERENA) |
| `--c-surface-1` | `#101052` | Tarjetas, paneles |
| `--c-surface-2` | `#20205D` | Tarjetas elevadas, inputs, chat del usuario |
| `--c-brand-purple` | `#5D0158` | Gradientes de marca, fondo del splash, halo del escaneo |
| `--c-magenta` | `#E62E9C` | Acción principal (un solo botón magenta por pantalla) |
| `--c-cyan` | `#2FA8C0` | Estados activos, progreso, foco, datos |
| `--c-text` | `#FFFFFF` | Texto principal |
| `--c-text-2` | `#B8B8CB` | Texto secundario |
| `--c-meta` | `#9999B5` | Etiquetas, metadatos |
| `--c-line` | `rgba(255,255,255,.10)` | Divisores |
| `--c-ink` | `#0B0B1A` | Texto sobre botón magenta |

**Colores semánticos (solo para estados, nunca decorativos):**

| Estado | Hex | Uso |
|---|---|---|
| Bien / Nivel bajo | `#7FD3E3` sobre `rgba(47,168,192,.16)` | Resultado tranquilo, luz óptima, sincronizado |
| Atención / Nivel moderado | `#F0CF7A` sobre `rgba(233,190,80,.16)` | Luz justa, acompañamiento sugerido, pendiente de sincronizar |
| Alerta / Nivel alto | `#F37CC2` sobre `rgba(230,46,156,.18)` | Luz insuficiente, escalamiento activo |
| Emergencia | `#E62E9C` sólido | Solo el botón de emergencia y la pantalla PEC |

**Modo claro de alto contraste (opcional, para sol directo en faena):** fondo `#F4F4FA`, superficie `#FFFFFF`, texto `#010147`, acción `#C0167A`, datos `#1B7F93`. Mostralo en una sola pantalla de ejemplo (Inicio, móvil).

### Tipografía

| Rol | Fuente | Detalle |
|---|---|---|
| Display / títulos | **Archivo** (ancho expandido 125 %, peso 700) | Tracking negativo leve (-0.02 em) en títulos grandes |
| Texto y UI | **IBM Plex Sans** 400/500/600 | Cuerpo 16 px móvil, 17 px escritorio, interlineado 1.55 |
| Datos, etiquetas, cifras | **IBM Plex Mono** 500 | Mayúsculas con tracking 0.08 em para etiquetas; cifras tabulares |

### Forma y detalle

- Radios mínimos: 2 px en botones e inputs, 12 px en tarjetas, píldoras para chips de estado.
- Trama de grilla tenue (líneas `--c-line` cada 64 px) solo en el splash y en el fondo del escaneo, como en el sitio.
- Halo circular con gradiente radial magenta → púrpura detrás del óvalo facial durante el escaneo.
- Íconos lineales de 1.5 px, sin emojis.
- Áreas táctiles de al menos 48 × 48 px (72 px en kiosco: se usan con guantes).
- Movimiento sobrio: respiración guiada con un círculo que se expande y contrae; el resto con transiciones de 200 ms. Respetar "reducir movimiento".

---

## 4. Arquitectura de navegación

**Móvil:** barra inferior de 5 ítems. **Tablet y escritorio:** barra lateral izquierda con los mismos ítems más "Privacidad" y "Dispositivos".

1. **Hoy** (inicio)
2. **Check-in**
3. **Acompañante** (asistente de IA)
4. **Mi bienestar** (historial y tendencias)
5. **Recursos**

**Siempre visibles, en todas las pantallas:**
- **Botón de emergencia** (esquina superior derecha, píldora magenta con ícono de señal, texto "Ayuda").
- **Indicador de sincronización** (punto cian = sincronizado, ámbar = pendiente, gris = sin conexión) junto al avatar.

---

## 5. Contenido de ejemplo (usalo tal cual)

- Usuario: **Matías R.**, operador de planta, faena "Mina Los Andes" (ficticia), roster 14 × 14.
- Estado del roster: **Día 9 de 14 · Turno noche**. En la vista web de casa: **Descanso · Día 3 de 14**.
- Último check-in: hoy 06:12, en la tablet del comedor.
- Racha: 6 check-ins en los últimos 9 días.
- Valores de ejemplo del escaneo: frecuencia cardíaca 78 lpm · variabilidad (HRV) 42 ms · respiración 15 rpm · índice de estrés 3,1 (escala 1–5, "moderado").
- Dispositivos vinculados: "Teléfono de Matías" (Android), "Tablet comedor — Módulo 3" (kiosco, sesión efímera), "Notebook casa" (web).

Mostrá un aviso discreto en el pie de cada pantalla de escritorio: *"Datos de ejemplo. Vista previa de diseño."*

---

## 6. Pantallas a diseñar

### 6.1 Splash y bienvenida
- Logo SERENA sobre fondo `--c-brand-purple` con gradiente al azul noche y trama de grilla.
- Frase: **"Un minuto para vos, en medio del turno."**
- Tres diapositivas de bienvenida:
  1. **"Esto es tuyo."** Tus resultados son solo tuyos. Tu empresa nunca ve tus datos individuales.
  2. **"Es voluntario."** Hacés el check-in cuando querés. No hacerlo no tiene ninguna consecuencia.
  3. **"No estás solo."** Si algo no anda bien, te ayudamos a llegar a quien puede ayudarte.

### 6.2 Consentimiento informado (granular y revocable)
Pantalla de lectura clara, no un muro legal. Cada permiso con su propio interruptor y una línea de explicación:
- Lectura fisiológica por cámara (NeuroSentinel™): *"La cámara mide tu pulso y respiración. El video se procesa en tu dispositivo y se descarta. No se guarda tu cara."*
- Autorreporte de ánimo y fatiga.
- Prueba de reacción y voz.
- Conversación con el acompañante: *"Tus conversaciones se guardan cifradas y solo vos podés verlas."*
- Geolocalización solo al usar el botón de emergencia.
- Enlace "Leer la política completa" y botón magenta **"Acepto y continúo"**. Texto al pie: *"Podés cambiar esto cuando quieras en Privacidad."*

### 6.3 Ingreso seguro
- Usuario corporativo o DNI + contraseña, luego **segundo factor** (código de 6 dígitos o biometría del teléfono).
- En el teléfono personal: desbloqueo con huella o rostro del sistema operativo + PIN de 4 dígitos para abrir la app.
- En escritorio: "Recordar este dispositivo por 30 días" (desactivado por defecto).
- Mensaje de error de ejemplo: *"El código no coincide. Revisá los 6 dígitos o pedí uno nuevo."*

### 6.4 Hoy (inicio)
- Saludo: **"Buenas noches, Matías."** Debajo, chip mono: `ROSTER · DÍA 9 DE 14 · TURNO NOCHE`.
- Tarjeta principal: **"¿Cómo estás hoy?"** con botón magenta **"Hacer mi check-in"** y la línea *"Menos de un minuto · Voluntario"*.
- Tarjeta del último resultado (nivel moderado, fecha y hora, dispositivo donde se hizo).
- Accesos rápidos: "Respirar 2 minutos", "Dormir mejor en turno noche", "Hablar con el acompañante".
- En la versión web de casa (Descanso · Día 3): cambia el mensaje a **"Bienvenido a casa. Tu cuerpo también necesita volver."** y destaca recursos de desconexión, sueño y familia.

### 6.5 Check-in — Paso 1: autorreporte
- Barra de progreso de 4 pasos arriba (`1 Ánimo · 2 Luz y encuadre · 3 Escaneo · 4 Reacción`).
- Pregunta: **"¿Cómo llegás a este momento del turno?"**
- Escala de 5 opciones grandes con palabras, no números ni caras: *Muy bien · Bien · Más o menos · Cansado · Muy cansado*.
- Segunda pregunta: **"¿Cuánto dormiste en tu último descanso?"** (menos de 4 h · 4 a 6 h · 6 a 8 h · más de 8 h).
- Enlace secundario: "Prefiero saltear el escaneo" (el check-in igual se registra solo con autorreporte).

### 6.6 Check-in — Paso 2: verificación de luz y encuadre (clave)
El escaneo **no puede empezar si la luz es insuficiente**. Diseñá tres estados de esta pantalla:

| Estado | Medidor | Mensaje | Botón "Empezar escaneo" |
|---|---|---|---|
| Insuficiente | Barra con 1/3 en `#F37CC2`, etiqueta `LUZ INSUFICIENTE` | *"Hay poca luz para medir bien. Acercate a una lámpara o mirá hacia una ventana."* | Desactivado |
| Justa | 2/3 en `#F0CF7A`, `LUZ JUSTA` | *"Casi. Si podés, sumá un poco de luz de frente."* | Activo, con aviso |
| Óptima | 3/3 en `#7FD3E3`, `LUZ ÓPTIMA` | *"Perfecto. Mantené la cara dentro del óvalo."* | Activo |

- Vista de cámara en vivo (usá una silueta ilustrada, no una foto real) con **óvalo guía** y checklist en vivo: ✓ Luz suficiente · ✓ Cara centrada · ✓ Sin movimiento · ✓ Sin contraluz.
- Consejos plegables: "Sacate el casco o las antiparras", "Evitá tener una ventana detrás", "Apoyá el dispositivo".
- Sello permanente bajo la cámara, en mono: `EL VIDEO NO SE GUARDA · SE PROCESA EN ESTE DISPOSITIVO`.

### 6.7 Check-in — Paso 3: escaneo NeuroSentinel™
- Óvalo facial con halo radial púrpura/magenta que pulsa suave y un anillo de progreso cian de 30 a 60 segundos.
- Contador grande: **"0:24"** y texto: *"Respirá normal. Quedate quieto."*
- Debajo, cuatro indicadores que se "encienden" a medida que la señal se estabiliza: Pulso · Variabilidad · Respiración · Estrés.
- Estado de interrupción: *"Perdimos la señal por movimiento. Retomamos en 3 segundos."*
- No mostrar marca de terceros: el módulo se llama **NeuroSentinel™**.

### 6.8 Check-in — Paso 4: reacción y voz
- Prueba de reacción: círculo que aparece en posiciones al azar, *"Tocá el círculo apenas aparezca"* (10 toques, unos 30 segundos).
- Voz: *"Leé en voz alta: 'Hoy es un buen día para volver a casa sano.'"* con visualizador de onda.
- Ambas se pueden saltear.

### 6.9 Resultado (tres variantes)
El trabajador ve sus propios valores. El lenguaje es amable y nunca diagnóstico.

**Nivel bajo:** chip `TODO EN ORDEN`. Título **"Estás en buen ritmo."** Valores en cuatro tarjetas mono. Sugerencia: "¿Querés dejar un registro de cómo te sentís?" Botón "Listo".

**Nivel moderado:** chip `TE CONVIENE UNA PAUSA`. Título **"Tu cuerpo está pidiendo un respiro."** Botón magenta **"Hacer una respiración guiada de 2 minutos"**. Secundario: "Contarle al acompañante". Nota: *"Te propongo otro check-in al final del turno."*

**Nivel alto:** pantalla de acompañamiento, no de alarma. Título **"No tenés que atravesar esto solo."** Texto: *"Vamos a conectarte con la guardia de tu faena. Solo ellos reciben este aviso, no tu supervisor."* Botón magenta **"Conectarme ahora"**, contador visible de 15 s con opción **"Ahora no, prefiero hablar con alguien de confianza"** y siempre la línea de emergencia visible.

En las tres variantes, pie fijo: `SOLO VOS VES ESTE RESULTADO`.

### 6.10 Acompañante SERENA (asistente de IA)
Chat con un acompañante de bienestar. Diseñá:

- Encabezado: avatar abstracto (onda o forma orgánica en gradiente magenta → cian, **nunca** una cara humana ni un robot), nombre **"Acompañante SERENA"** y estado "Disponible 24/7".
- **Banner fijo arriba** (plegable pero nunca eliminable): *"Soy un acompañante, no un profesional de la salud. Estoy para escucharte y charlar. Si necesitás ayuda profesional, te ayudo a encontrarla."*
- Burbujas: acompañante en `--c-surface-1`, usuario en `--c-surface-2` con borde cian.
- Respuestas rápidas: "Estoy cansado" · "Extraño a mi familia" · "No puedo dormir" · "Solo quiero charlar".
- Botón permanente en la barra del chat: **"Hablar con una persona"**.
- Conversación de ejemplo:
  - Usuario: *"Estoy en el día 9 y ya no doy más, extraño a mis hijos."*
  - Acompañante: *"Te entiendo, Matías. Nueve días lejos pesan, y más con turno noche. Extrañar a tus hijos habla de lo mucho que te importan. ¿Pudiste hablar con ellos en estos días?"*
  - Usuario: *"Poco, la señal es mala."*
  - Acompañante: *"Qué bronca, eso lo hace más difícil. Si querés, podemos pensar juntos un momento del día para intentarlo, o podés grabarles un audio ahora para mandarlo cuando haya señal. ¿Qué te parece?"*
- **Estado de cuidado (crisis):** si la persona expresa querer hacerse daño, el chat cambia a una tarjeta fija arriba: **"Lo que me contás es importante y merece ayuda de una persona ahora."** Con dos botones: **"Conectarme con la guardia de mi faena"** y **"Llamar a una línea de ayuda"**, que muestra los números del país. El acompañante sigue en la conversación con tono sereno, sin cerrar el chat.

### 6.11 Mi bienestar (historial)
- Gráfico de 28 días con **bandas de fondo que marcan días de trabajo y de descanso del roster** (trabajo en `--c-surface-2`, descanso en `--c-surface-1`), línea de índice de estrés en cian y puntos del autorreporte.
- Selector: Estrés · Variabilidad · Sueño declarado · Ánimo.
- Insight en lenguaje simple: *"En tus últimos dos rosters, el cansancio sube a partir del día 10. Es común. Probá sumar una pausa corta desde el día 8."*
- Lista de check-ins con dispositivo de origen (ícono teléfono, tablet o notebook).
- Botón secundario: "Descargar mis datos".

### 6.12 Recursos
Tarjetas con duración en mono:
- Respiración guiada (2 min, 5 min) con círculo animado.
- Dormir mejor en turno noche (4 lecturas cortas).
- Volver a casa después del roster (desconexión y reencuentro con la familia).
- Manejo del estrés en el turno.
- Alcohol y descanso: información sin juicio (con acceso confidencial a ayuda).

### 6.13 Botón de emergencia (desde cualquier pantalla)
- Hoja modal a pantalla completa en `--c-magenta` sobre azul noche.
- Título **"¿Necesitás ayuda ahora?"**
- Opciones grandes: **"Emergencia física"** (accidente, lesión, gas, atrapamiento) · **"Necesito hablar con alguien"** · **"Estoy en riesgo"**.
- Interruptor: "Compartir mi ubicación con la guardia" (activado solo en esta pantalla).
- Confirmación con **deslizar para enviar** (evita toques accidentales) y luego estado: *"Aviso enviado a la guardia de Mina Los Andes. Quedate en línea."* con hora y canal.
- Si no hay conexión: *"Sin señal. Guardamos el aviso y lo enviamos apenas haya conexión. Si podés, avisá por radio."*

### 6.14 Privacidad y datos
- Resumen visual: **"Quién ve qué"** en tres columnas: *Vos* (todo) · *Guardia de emergencia* (solo cuando pedís ayuda o hay riesgo alto) · *Tu empresa* (solo estadísticas anónimas del grupo, nunca tu nombre).
- Interruptores de consentimiento del punto 6.2.
- Acciones: "Descargar mis datos" · "Borrar mi historial" · "Retirar mi consentimiento" (con confirmación en la propia página).
- Registro de accesos: *"Tu información se compartió 0 veces en los últimos 90 días."*
- Texto legal breve: Ley N.º 25.326 de Protección de Datos Personales (Argentina).

### 6.15 Dispositivos y sincronización
- Lista de dispositivos vinculados con última sincronización, sistema y botón "Cerrar sesión en este dispositivo".
- Estado: `SINCRONIZADO · HACE 2 MIN` o `3 REGISTROS ESPERANDO CONEXIÓN`.
- Explicación: *"Todo lo que hagas en el campamento aparece en tu teléfono y en la web de tu casa. Sin señal, la app guarda todo cifrado y lo sube cuando vuelve la conexión."*

### 6.16 Modo kiosco (tablet fija en acceso o comedor)
- Pantalla de espera vertical: logo, hora grande, **"Check-in de bienestar · Voluntario · Confidencial"**, botón gigante **"Empezar"**.
- Identificación: escanear el QR de la credencial o ingresar legajo + PIN.
- Mismo flujo de check-in con botones de 72 px.
- Cierre: *"Listo, Matías. Tu registro ya está en tu teléfono."* y **cierre de sesión automático a los 20 segundos** con cuenta regresiva visible. Nada queda en pantalla.

---

## 7. Estados del sistema que tienen que verse

- Sin conexión (banner gris: *"Sin conexión. Todo se guarda y se sincroniza después."*).
- Sincronizando (spinner cian en el indicador).
- Cámara sin permiso: *"Para el escaneo necesitamos la cámara. Podés habilitarla en ajustes o hacer el check-in sin escaneo."*
- Cámara no disponible en escritorio: ofrecer check-in solo con autorreporte.
- Sesión cerrada por inactividad (5 min en tablet compartida, 15 min en escritorio).

---

## 8. Entregable esperado de Claude Design

1. Prototipo navegable con el flujo completo: Splash → Consentimiento → Ingreso → Hoy → Check-in (4 pasos) → Resultado moderado → Respiración guiada → Hoy.
2. Frames móvil y escritorio de: Hoy, Luz y encuadre (3 estados), Escaneo, Resultado (3 variantes), Acompañante (normal y estado de cuidado), Mi bienestar, Privacidad, Dispositivos.
3. Frames kiosco: espera, identificación, cierre con cuenta regresiva.
4. Botón de emergencia abierto en móvil.
5. Una pantalla en modo claro de alto contraste.
6. Hoja de componentes: botones, chips de estado, medidor de luz, tarjeta de valor fisiológico, burbuja de chat, barra de navegación, indicador de sincronización.

---

## Anexo técnico (contexto para el diseño, no para dibujar)

**Módulo de escaneo.** NeuroSentinel™ integra el SDK de lectura de signos vitales por cámara de Shen.AI en modalidad marca blanca (sin marcas de terceros). Mide frecuencia cardíaca, HRV, respiración e índice de estrés en 30 a 60 segundos, con procesamiento en el dispositivo. Pendiente de confirmar con Shen.AI: operación 100 % offline con licencia sin internet, soporte web/kiosco, requisitos mínimos de cámara y luz en todos los tonos de piel, y confirmación de que no se almacenan ni transmiten imágenes.

**Verificación de luz.** Doble control antes de habilitar el escaneo: (1) sensor de luz ambiente del equipo donde exista (Android y tablets industriales); (2) en todos los dispositivos, incluidos iPhone y web donde no hay acceso al sensor, luminancia media calculada sobre la región del rostro en los fotogramas de la cámara, más detección de contraluz. Los umbrales de "insuficiente / justa / óptima" se calibran en el trial de 30 días; el SDK además aporta su propio control de calidad de señal.

**Sincronización.** Arquitectura offline-first: base local cifrada en cada dispositivo, cola de sincronización, resolución de conflictos por marca de tiempo y dispositivo de origen, sincronización incremental cuando vuelve Starlink/LTE. Una cuenta, varios dispositivos; el kiosco nunca guarda datos del trabajador después de cerrar la sesión.

**Protección.** Cifrado en tránsito (TLS 1.3) y en reposo (AES-256); claves por usuario; doble factor; PIN y biometría local; sesiones efímeras en kiosco; cierre remoto de sesiones; registro de auditoría de cada escalamiento; separación total entre datos individuales (solo trabajador y guardia en escalamiento) y reportes agregados anónimos para la empresa; sin almacenamiento de video ni plantillas biométricas; cumplimiento de la Ley N.º 25.326 y, para Chile, de la ley de datos personales vigente.

**Acompañante de IA.** Perfil de acompañamiento con escucha activa y calidez, inspirado en la actitud de un psicólogo que acompaña, **sin rol profesional**: no diagnostica, no indica tratamientos ni medicación, no reemplaza a un profesional. Reglas: validar emociones, preguntar más que afirmar, sugerir solo recursos de la propia app (respiración, sueño, contacto con la familia) y derivar a personas cuando corresponde. Ante señales de riesgo, activa el estado de cuidado, ofrece la guardia de la faena (Protocolo de Escalamiento Configurable) y las líneas de ayuda del país. Las conversaciones se guardan cifradas y solo el trabajador puede verlas; nunca se usan para evaluar desempeño.
