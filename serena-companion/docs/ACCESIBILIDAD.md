# Accesibilidad — SERENA Companion

Objetivo: **WCAG 2.2 nivel AA** en todas las pantallas (trabajador en teléfono y escritorio, kiosco y
panel de la empresa), en los dos temas: **noche** (predeterminado) y **sol** (alto contraste para
exteriores).

## Cómo se verifica

| Capa | Qué cubre | Dónde |
|---|---|---|
| Automática (axe-core 4.13) | Reglas WCAG 2.0/2.1/2.2 A y AA + buenas prácticas, en ~35 pantallas × 2 temas. Falla la integración continua si aparece un hallazgo. | `e2e/app/accesibilidad.spec.ts` |
| Automática (criterios que axe no mide) | Teclado, alternativa al arrastre, saltar bloques, títulos, reflujo a 320 px, aviso de inactividad y movimiento reducido. | `e2e/app/teclado-y-movimiento.spec.ts` |
| Manual | Revisión criterio por criterio (tabla de abajo). | Este documento |

Línea de base antes de las correcciones (punto A11): **131 hallazgos automáticos en 8 reglas**; después: **0**.

## Estado por criterio (A y AA)

✅ cumple · ⚠️ cumple con observaciones · 🔲 pendiente de verificación con personas

| Criterio | Estado | Cómo se cumple / verifica |
|---|---|---|
| 1.1.1 Contenido no textual | ✅ | Íconos decorativos con `aria-hidden`; logo con texto alternativo; el gráfico de Mi bienestar tiene una tabla equivalente para lectores de pantalla; indicador del PIN como imagen con texto ("2 de 4 dígitos"). |
| 1.2.x Multimedia | n/a | La app no reproduce audio ni video. La prueba de voz graba, no reproduce. |
| 1.3.1 Información y relaciones | ✅ | Un `<main>`, `<header>` y `<nav>` por pantalla; un `<h1>` por pantalla; formularios con `<label>`; opciones de ánimo como `fieldset`/`legend` con radios; tabla con `caption` y `th`. |
| 1.3.2 Secuencia significativa | ✅ | Orden del DOM = orden visual. |
| 1.3.3 Características sensoriales | ✅ | Las instrucciones no dependen de forma ni posición ("Tocá el círculo" tiene alternativa por teclado y anuncio "Ahora"). |
| 1.3.4 Orientación | ✅ | Funciona en vertical y horizontal. |
| 1.3.5 Propósito de los campos | ✅ | `autocomplete` en usuario, contraseña actual/nueva y código de un solo uso. |
| 1.4.1 Uso del color | ✅ | Los niveles (bien / moderado / alto) siempre llevan texto, no solo color. |
| 1.4.3 Contraste (texto) | ✅ | Mínimos medidos: noche 5,25:1; sol 5,13:1 (cian corregido de 4,25:1 a `#16707f`). Botón de acción 4,86:1 (noche) y 5,77:1 (sol). |
| 1.4.4 Cambio de tamaño del texto | ✅ | Tipografía en unidades relativas; sin texto en imágenes. |
| 1.4.10 Reflujo | ✅ | Sin desplazamiento horizontal a 320 px (verificado en Hoy, Mi bienestar, Privacidad, Acompañante y Recursos). Se corrigieron el chip del roster y la fila de respuestas rápidas. |
| 1.4.11 Contraste no textual | ✅ | Foco, bordes e indicadores cian ≥ 5:1 en ambos temas (en sol el cian anterior daba 2,8:1). |
| 1.4.12 Espaciado del texto | ✅ | Sin alturas fijas en contenedores de texto. |
| 1.4.13 Contenido al pasar el puntero | ✅ | El detalle del gráfico no tapa el dato, desaparece al salir y se repite por `aria-live`. |
| 2.1.1 Teclado | ✅ | Todo operable con teclado, incluida la prueba de reacción (Espacio) y el pedido de ayuda (el control deslizante acepta → / Fin). Probado de punta a punta sin mouse. |
| 2.1.2 Sin trampas de teclado | ✅ | Diálogos con Escape y botón Cerrar. |
| 2.1.4 Atajos de una tecla | ✅ | Espacio solo actúa durante la prueba de reacción, y no si el foco está en otro control. |
| 2.2.1 Tiempo ajustable | ✅ | Cierre por inactividad (seguridad) con aviso **un minuto antes** y botón "Sigo acá". El código 2FA vence a los 5 min y se puede pedir otro. La prueba de reacción mide tiempo por definición (excepción "esencial") y se puede saltear. |
| 2.2.2 Pausar, detener, ocultar | ✅ | La respiración guiada dura 2 min, se puede salir y respeta movimiento reducido. |
| 2.3.1 Destellos | ✅ | Sin destellos. |
| 2.4.1 Saltar bloques | ✅ | Enlace "Saltar al contenido" como primer elemento enfocable. |
| 2.4.2 Título de página | ✅ | `«Pantalla» · SERENA Companion` en cada ruta. |
| 2.4.3 Orden del foco | ✅ | Al cambiar de pantalla el foco pasa al contenido principal (el lector anuncia la pantalla nueva); los diálogos enfocan su acción principal. |
| 2.4.4 Propósito de los enlaces | ✅ | Textos de enlace descriptivos. |
| 2.4.5 Múltiples vías | ✅ | Menú principal + accesos rápidos en Hoy. |
| 2.4.6 Encabezados y etiquetas | ✅ | |
| 2.4.7 Foco visible | ✅ | Contorno cian de 2 px en todos los controles. |
| 2.4.11 Foco no oculto | ✅ | La barra inferior y la cabecera no tapan el elemento enfocado. |
| 2.5.1 Gestos con el puntero | ✅ | Ningún gesto multipunto ni de trayectoria. |
| 2.5.2 Cancelación del puntero | ✅ | Los botones actúan al soltar. Excepciones esenciales: la prueba de reacción (mide el toque) y el control deslizante (se cancela soltando antes del final). |
| 2.5.3 Etiqueta en el nombre | ✅ | El nombre accesible contiene el texto visible. |
| 2.5.4 Activación por movimiento | n/a | |
| 2.5.7 Movimientos de arrastre | ✅ | "Deslizar para enviar" tiene alternativa: **"Enviar con dos toques"** (dos botones distintos, igual de difícil de activar por error). |
| 2.5.8 Tamaño del objetivo | ✅ | Controles ≥ 44 px. El gráfico dejó de tener puntos de 9 px: toda el área es el objetivo y se elige el día más cercano. |
| 3.1.1 Idioma de la página | ✅ | `lang="es-AR"`. |
| 3.2.1 / 3.2.2 Al recibir foco / entrada | ✅ | Nada cambia de contexto solo por enfocar o escribir (el código 2FA se envía al completar los 6 dígitos, comportamiento esperado y anunciado). |
| 3.2.3 / 3.2.4 Navegación e identificación coherentes | ✅ | Mismo menú y mismas etiquetas en todas las pantallas. |
| 3.2.6 Ayuda coherente | ✅ | El botón Ayuda está siempre en el mismo lugar (arriba a la derecha). |
| 3.3.1 Identificación de errores | ✅ | Errores con `role="alert"` y texto concreto. |
| 3.3.2 Etiquetas o instrucciones | ✅ | La política de contraseñas se explica antes de escribir y se avisa mientras se escribe. |
| 3.3.3 Sugerencias ante errores | ✅ | Mensajes que dicen qué hacer ("Revisá los 6 dígitos o pedí uno nuevo"). |
| 3.3.4 Prevención de errores | ✅ | Confirmación en acciones con consecuencias (baja, borrar historial, eliminar cuenta, retirar consentimiento). |
| 3.3.7 Entrada redundante | ✅ | No se pide dos veces lo mismo, salvo repetir la contraseña nueva (excepción de seguridad). |
| 3.3.8 Autenticación accesible | ✅ | Se puede pegar la contraseña y el código (el código también se completa con autocompletado del SMS); no hay CAPTCHA ni pruebas cognitivas. |
| 4.1.2 Nombre, función, valor | ✅ | Controles nativos o con el rol correcto (se corrigió `role="tab"` con `aria-pressed` en Mi bienestar). |
| 4.1.3 Mensajes de estado | ✅ | Estado del aviso a la guardia, sincronización, resultados de acciones y valores del gráfico con `role="status"` / `aria-live`. |

## Limitaciones conocidas y próximos pasos

1. 🔲 **Prueba con personas.** Las verificaciones automáticas y la revisión manual no reemplazan probar con
   usuarios reales de **TalkBack** (Android, el más probable en faena), **VoiceOver** (iOS) y **NVDA**
   (escritorio). Recomendado antes del piloto: 3 a 5 personas, incluida al menos una con baja visión.
2. ⚠️ **Escaneo facial (SDK pendiente).** La lectura por cámara exige encuadrar la cara: no es utilizable sin
   visión. Es **opcional**: el check-in funciona sin escaneo (ánimo, sueño y pruebas cortas) y el nivel se
   calcula igual. Cuando llegue el SDK, revisar si ofrece guía por voz para el encuadre.
3. ⚠️ **Prueba de voz.** Requiere hablar: se puede saltear y no afecta el pedido de ayuda.
4. ⚠️ **Ambiente de faena.** Ruido y guantes: los objetivos grandes y la alternativa de dos toques ayudan, pero
   conviene probar el kiosco con guantes de trabajo en el piloto.
5. Textos legales (política de privacidad): en revisión por la Abogada Karina Viñas; cuando estén
   definitivos, revisar su lectura fácil (nivel de lenguaje), que no es un requisito AA pero sí recomendable.
