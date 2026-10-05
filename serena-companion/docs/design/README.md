# Handoff: SERENA Companion™

Velasco Robota · Tecnología Robota Technologies · Septiembre 2026

## Overview
SERENA Companion™ es la app personal de bienestar del trabajador minero dentro de SERENA Centinela. **Una sola app responsive** para cuatro contextos: móvil (390×844), tablet horizontal (1194×834), escritorio web (1440×900) y kiosco vertical (1080×1920, sesión efímera). Una cuenta, varios dispositivos, offline-first.

Principio rector: **"La app cuida; no vigila."** Todo transmite: esto es tuyo, es voluntario, nadie te juzga.

## About the Design Files
Los archivos de este paquete son **referencias de diseño hechas en HTML**: prototipos que muestran el aspecto y el comportamiento buscados, **no código de producción para copiar**. La tarea es **recrear estos diseños en el entorno del proyecto destino** (React Native / Flutter / React + PWA, etc.) con sus patrones y librerías. Si todavía no hay código, elegí el framework más apropiado. Recomendación: React Native + Expo (móvil y tablet) y React web (escritorio y kiosco en modo PWA a pantalla completa), con una capa de dominio compartida.

Para abrir el prototipo: servir la carpeta con un servidor estático (`npx serve .`) y abrir `SERENA Companion.dc.html`. `support.js` es el runtime del prototipo y no forma parte del producto. La lógica completa (estados, flujos, datos de ejemplo) está en la clase `Component` dentro del `<script data-dc-script>`.

En el prototipo:
- La barra superior cambia de dispositivo. "Siguiente en el flujo" recorre el camino feliz.
- El panel izquierdo lista las pantallas. El panel derecho, las variantes y los estados del sistema.
- El tweak `presentacion` oculta los paneles y `marcadores` muestra u oculta los espacios reservados (borde punteado).

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografía, textos (voseo rioplatense, **usar tal cual**), jerarquía e interacciones son finales. Solo quedan abiertos los puntos de la sección "Pendientes / espacios reservados".

---

## Design Tokens

### Colores
| Token | Hex | Uso |
|---|---|---|
| `bg` | `#010147` | Fondo principal |
| `bg-nav` | `#010140` | Barra lateral e inferior |
| `surface-1` | `#101052` | Tarjetas, burbuja del acompañante |
| `surface-2` | `#20205D` | Tarjetas elevadas, inputs, burbuja del usuario |
| `brand-purple` | `#5D0158` | Gradiente del splash, halo del escaneo |
| `magenta` | `#E62E9C` | **Una sola acción principal por pantalla**, píldora Ayuda, emergencia |
| `cyan` | `#2FA8C0` | Activo, progreso, foco, datos, enlaces |
| `text` | `#FFFFFF` | Texto principal |
| `text-2` | `#B8B8CB` | Secundario |
| `meta` | `#9999B5` | Etiquetas mono, metadatos |
| `line` | `rgba(255,255,255,.10)` | Divisores y bordes de tarjeta |
| `ink` | `#0B0B1A` | Texto sobre magenta |
| `offline` | `#2E2E4A` banner · `#6E6E8C` punto | Sin conexión |

Semánticos (solo estados, nunca decorativos):
| Estado | Texto | Fondo |
|---|---|---|
| Bien / bajo / óptima / sincronizado | `#7FD3E3` | `rgba(47,168,192,.16)` |
| Atención / moderado / justa / pendiente | `#F0CF7A` | `rgba(233,190,80,.16)` |
| Alerta / alto / insuficiente | `#F37CC2` | `rgba(230,46,156,.18)` |
| Emergencia | `#E62E9C` sólido | — |

Modo claro de alto contraste (sol directo): fondo `#F4F4FA`, superficie `#FFFFFF`, texto `#010147`, acción `#C0167A` (texto blanco), datos `#1B7F93`, bordes 1.5 px `#010147`.

### Tipografía
- **Display:** Archivo, `font-stretch:125%`, 700, `letter-spacing:-0.02em`. H1 de pantalla: `clamp(28px, 4.4cqi, 46px)`, line-height 1.1. H2 de tarjeta: 20–32 px.
- **Texto / UI:** IBM Plex Sans 400/500/600. Cuerpo 16 px en móvil y 17 px en escritorio, line-height 1.55. Botones 17 px/600.
- **Datos / etiquetas:** IBM Plex Mono 500, MAYÚSCULAS, `letter-spacing:0.08em`, 10.5–12 px. Cifras con `font-variant-numeric: tabular-nums` (26–40 px).

### Forma, espaciado, movimiento
- Radios: **2 px** botones e inputs · **12 px** tarjetas · **999 px** chips y píldoras · teclas PIN 12 px.
- Espaciado: padding de pantalla `clamp(20px, 4cqi, 48px)`, ancho máximo del contenido 1120 px (resultado 920, chat 880). Gaps de 6/10/12/16/24 px.
- Áreas táctiles: **mínimo 48 px** (botón principal 52 px); **72 px en kiosco** (se usa con guantes).
- Grilla de fondo de 64 px en `rgba(255,255,255,.05–.06)`, **solo** en splash, escaneo y espera del kiosco.
- Transiciones de 200 ms. Respiración: ciclo de 10 s (inhalar 4 s, exhalar 6 s), escala 0.5→1. Halo: 3.2 s ease-in-out, escala 0.94↔1.05. **Respetar `prefers-reduced-motion`** (sin animación, solo el contador).
- Íconos lineales de 1.5 px (`stroke-linecap/linejoin: round`), sin emojis. Sombra: solo en el marco del dispositivo del prototipo, no en la UI.

---

## Navegación
- **Móvil:** barra inferior de 84 px con 5 ítems (Hoy · Check-in · Acompañante · Mi bienestar · Recursos). El activo va en cian. Se oculta durante el check-in y la respiración.
- **Tablet:** barra lateral colapsada de 88 px (solo íconos + marca). **Escritorio:** barra lateral de 252 px con logo, los 5 ítems + Privacidad + Dispositivos, y el usuario abajo.
- **Siempre visibles** en el encabezado (60 px en móvil, 72 en escritorio, 96 en kiosco): indicador de sincronización + avatar "MR" + **píldora magenta "Ayuda"** (40 px de alto; 64 en kiosco) que abre Emergencia desde cualquier pantalla.
- Escritorio: pie con *"Datos de ejemplo. Vista previa de diseño."* (solo en la vista previa).

## Screens / Views

| Ref | Pantalla | Variantes / estados |
|---|---|---|
| 6.1 | Splash + 3 diapositivas de bienvenida | splash, 1/2/3 (con puntos de progreso y "Saltear") |
| 6.2 | Consentimiento granular | 5 interruptores independientes (48 px de área, pista de 48×28) |
| 6.3 | Ingreso seguro | usuario/DNI + contraseña → 2FA de 6 dígitos → error → PIN de 4 + huella (móvil). "Recordar 30 días" solo en escritorio, desactivado por defecto |
| 6.4 | Hoy | en turno (día 9, noche) · en casa (descanso día 3, recursos de desconexión) · alto contraste |
| 6.5 | Check-in 1: ánimo | 5 palabras (sin números ni caras) + 4 rangos de sueño + "Prefiero saltear el escaneo" |
| 6.6 | Check-in 2: luz y encuadre | insuficiente (botón **desactivado**) · justa (activo + aviso) · óptima · cámara sin permiso · sin cámara (escritorio) |
| 6.7 | Check-in 3: escaneo NeuroSentinel™ | en curso (anillo cian, contador, 4 indicadores que se encienden) · señal perdida (se reanuda a los 3 s) · completo |
| 6.8 | Check-in 4: reacción y voz | 10 toques en posiciones al azar + frase leída con onda; ambas se pueden saltear |
| 6.9 | Resultado | bajo · moderado · alto (cuenta de 15 s para conectar con la guardia, opción "Ahora no…", línea de emergencia fija). Pie fijo `SOLO VOS VES ESTE RESULTADO` |
| — | Respiración guiada | 2:00, círculo que crece y se achica, Inhalá/Exhalá |
| 6.10 | Acompañante | conversación · estado de cuidado (tarjeta fija con guardia + líneas de ayuda). Banner "no soy un profesional" **plegable, nunca eliminable**. Avatar orgánico en gradiente, nunca una cara |
| 6.11 | Mi bienestar | gráfico de 28 días con bandas trabajo/descanso, selector de 4 métricas, texto de interpretación, lista con dispositivo de origen |
| 6.12 | Recursos | 5 tarjetas con duración en mono |
| 6.13 | Emergencia (hoja modal) | elegir tipo → ubicación → **deslizar para enviar** (umbral 86 %) → enviado · sin señal (en cola) |
| 6.14 | Privacidad | Quién ve qué (3 columnas) · permisos · descargar / borrar / retirar con confirmación en la misma página · registro de accesos · Ley 25.326 |
| 6.15 | Dispositivos | 3 dispositivos, cerrar sesión por dispositivo, chip de sincronización |
| 6.16 | Kiosco | espera (hora grande) · identificación por QR o legajo + PIN · cierre con cuenta de 20 s y cierre de sesión automático |

Estados globales (§7): sin conexión (banner gris), sincronizando (spinner cian), pendiente (punto ámbar), sesión cerrada por inactividad (5 min en tablet y kiosco, 15 min en escritorio).

**Copy:** todos los textos del prototipo y del brief (`brief/`) son finales. Nunca usar lenguaje clínico ("paciente", "trastorno", "diagnóstico").

## Interactions & Behavior
- Flujo principal: Splash → Consentimiento → Ingreso → Hoy → Check-in 1–4 → Resultado moderado → Respiración → Hoy. En kiosco termina en Cierre, con cuenta de 20 s y vuelta a Espera.
- "Empezar escaneo" se habilita solo con luz justa u óptima y cámara disponible. Saltear el escaneo registra el check-in solo con autorreporte.
- Escaneo: duración configurable de 30 a 60 s. Los indicadores se encienden al estabilizarse cada métrica (evento `metrica.estable`).
- Resultado alto: la cuenta de 15 s conecta automáticamente salvo que la persona elija "Ahora no…". **Solo la guardia recibe el aviso, nunca el supervisor.**
- Acompañante: el estado de cuidado lo activa la detección de riesgo del lado del servidor. El chat no se cierra y sigue con tono sereno.
- Emergencia: el interruptor de ubicación está activado por defecto **solo en esta pantalla**. Sin conexión, el aviso queda en cola y se reintenta; se sugiere avisar por radio.

## State Management
- **Sesión:** usuario, dispositivo (`mobile|tablet|desktop|kiosk`), `efimera` (kiosco), temporizador de inactividad.
- **Sincronización:** `ok | sincronizando | pendiente(n) | offline`. Base local cifrada (AES-256), cola de subida, conflictos resueltos por marca de tiempo + dispositivo de origen, sincronización incremental.
- **Consentimientos:** `{camara, animo, reaccion, chat, geo}`, cada uno revocable. Si un permiso está apagado, se oculta el paso correspondiente del check-in.
- **Check-in:** `{animo, sueno, luz, escaneo{estado, progreso, metricas}, reaccion{toques, ms}, voz, nivel}`.
- **Chat:** mensajes cifrados, solo del usuario. `modoCuidado: boolean`.
- **Emergencia:** `{tipo, compartirUbicacion, estado: elegir|enviado|en_cola, hora, canal}`.
- **Kiosco:** no guarda nada del trabajador al cerrar la sesión.

## Pendientes / espacios reservados (borde punteado en el prototipo)
**SDK de escaneo:** NeuroSentinel™ = SDK de Shen.AI en **marca blanca** (sin marcas de terceros en la UI). Se monta en dos slots: la vista de cámara (6.6) y el óvalo de escaneo (6.7).

Contrato de eventos que espera la UI:
| Evento | Datos | UI |
|---|---|---|
| `calidad` | luz, rostro_centrado, movimiento, contraluz | Medidor y checklist (6.6) |
| `progreso` | 0–1 | Anillo y contador (6.7) |
| `metrica` | pulso, hrv, respiracion, estres + `estable` | 4 indicadores (6.7) |
| `senal_perdida` | motivo | Aviso "Retomamos en 3 s" |
| `completo` | valores + calidad | Resultado (6.9) |
| `error` | `sin_permiso · sin_camara · no_soportado · sin_licencia` | Estados de cámara (§7) |

Por confirmar con Shen.AI:
- **P1 · Offline con licencia.** Si no se confirma, mostrar "Escaneo no disponible sin conexión" y seguir con autorreporte.
- **P2 · Soporte en web y kiosco.** Si no hay soporte, usar el estado "Sin cámara".
- **P3 · Cámara y luz en todos los tonos de piel.** Los umbrales quedan como parámetros remotos.
- **P4 · Sin almacenamiento ni transmisión de imágenes.** Condiciona el sello "El video no se guarda" y el texto del consentimiento.

Otros datos abiertos:
- Umbrales de luz y de nivel bajo/moderado/alto: se calibran en el trial de 30 días; exponerlos como configuración remota.
- Líneas de ayuda por país (135 AR y \*4141 CL, **sin verificar**) y canal de la guardia (PEC): configurables por faena.
- URL de la política completa y ley de datos de Chile.

## Seguridad (del anexo técnico)
TLS 1.3 en tránsito y AES-256 en reposo; claves por usuario; 2FA; PIN y biometría local; sesiones efímeras en kiosco; cierre remoto de sesiones; auditoría de cada escalamiento; separación total entre datos individuales y reportes agregados anónimos. No se guarda video ni plantillas biométricas.

## Assets
- `assets/serena-logo-white.png`: wordmark blanco con el círculo en color, fondo transparente (2480×718). Uso sobre fondo oscuro: splash, encabezado, barra lateral, kiosco.
- `assets/serena-mark.png`: solo el círculo con la cabeza (540×540). Uso en bienvenida, login, tablet y alto contraste.
- Originales del cliente: `Caratula.png` y `SERENA01.png`, fuera de este paquete.
- La silueta de la cámara es un placeholder: en producción la reemplaza el video del SDK.
- Fuentes: Google Fonts (Archivo con eje `wdth`, IBM Plex Sans, IBM Plex Mono).

## Files
- `SERENA Companion.dc.html`: prototipo completo (plantilla + lógica).
- `support.js`: runtime del prototipo (no va a producción).
- `assets/`: logos.
- `brief/SERENA_Companion_Claude_Design.md`: brief original del cliente (textos, tokens, anexo técnico).
