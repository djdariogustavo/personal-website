# Arquitectura por módulos — SERENA Companion

Guía para ubicar una falla: cada parte del sistema vive en un módulo con una sola responsabilidad y sus propias
pruebas. Para corregir algo se abre **solo** el módulo que corresponde, se corrige y se corre su prueba.

## Mapa general

| Parte | Carpeta | Qué hace | Pruebas |
|---|---|---|---|
| Reglas del negocio | `packages/domain/src` | Niveles, roster, divulgación estadística, contraseñas, facturación. Sin red ni pantalla. | `packages/domain/test` |
| Servidor | `apps/server/src` | API, sesión, cifrado, pagos, SMS, avisos a la guardia. | `apps/server/test` |
| App (pantallas) | `apps/web/src/screens` | Una pantalla o paso por archivo. | `e2e/app` |
| Escaneo | `apps/web/src/scan` | Todo lo del SDK de escaneo (ver abajo). | `apps/web/test/scan-*.test.ts` |
| Indicadores oculares | `apps/web/src/ocular` | Somnolencia sobre el video (modo registro). | `apps/web/test` |
| Sincronización y datos locales | `apps/web/src/lib` | Cola sin conexión, base local cifrada, sesión. | `apps/web/test` |

## Servidor: una ruta por archivo

`apps/server/src/routes/`: `auth`, `password`, `checkins`, `escaneo`, `companion`, `safety` (pedido de ayuda),
`privacy`, `admin`. Pagos en `payments/` (un archivo por medio de pago). SMS en `sms/`. Las cabeceras de seguridad y el
armado de la app están en `app.ts`; las variables de entorno, en `env.ts`.

## Panel de la empresa: una pantalla por archivo

`apps/web/src/screens/admin/`:

| Archivo | Pantalla |
|---|---|
| `Estadisticas.tsx` | Participación y niveles por día de roster (anónimos) |
| `Facturacion.tsx` | Plan, medio de pago y datos de facturación |
| `OrdenCompra.tsx` | Orden de compra por transferencia |
| `PagoPrueba.tsx` | Pago simulado (solo desarrollo) |
| `Equipo.tsx` | Altas, bajas y credenciales |
| `comun.tsx` | Lo compartido (mensajes de error, tarjeta de valor) |
| `Admin.tsx` | Solo reexporta las anteriores |

## Escaneo: unidades

El resto de la app solo conoce el contrato `ScanProvider` (`packages/domain/src/scan.ts`): `availability`,
`mountPreview`, `start`, `stop` y los eventos `calidad`, `progreso`, `metrica`, `senal_perdida`, `completo`, `error`.
Ninguna pantalla sabe qué SDK hay detrás.

| Síntoma | Archivo a abrir | Qué contiene |
|---|---|---|
| El SDK no carga, la licencia falla, "Preparando…" no termina | `scan/sdk/inicio.ts` | Descarga del motor, credencial, lienzo, `initialize`, cámara, con sus topes de tiempo |
| El reloj no arranca, la medición termina sin resultado | `scan/sdk/medicion.ts` | Una medición paso a paso: pedido de arranque y reintentos, progreso, resultado |
| Un estado o una métrica se traduce mal (cara cerca, estrés 1–5) | `scan/shenai-map.ts` | Traducción pura del SDK al contrato de SERENA |
| Falta información en los registros de Render | `scan/sdk/diagnostico.ts` | Qué se informa (nunca valores de salud) |
| El proveedor cambió su API | `scan/sdk/tipos.ts` | La única descripción del SDK en el proyecto |
| Cámara, temporizador, apagado | `scan/sdk/proveedor.ts` | Une las unidades anteriores |
| Elegir proveedor, token, envío del diagnóstico | `scan/registry.ts` | Registro |
| El marco (iframe) no carga o no se descarta | `scan/marco/proveedor.ts` | Carga, uso y descarte del marco |

### El SDK en un marco (iframe)

El SDK puede correr de dos maneras; la app es la misma y se elige en el servidor:

- **En la página (por defecto).** El SDK corre dentro de la app.
- **En un marco** (`SERENA_ESCANEO_MARCO=true` en el servidor). El SDK corre en una página aparte,
  `/escaneo-marco.html`, que la app carga en un marco oculto del mismo origen.

Ventajas del marco:

1. **Seguridad.** El SDK exige `unsafe-eval` en la política de contenido. Con el marco, ese permiso queda solo en la
   página del SDK y en sus archivos (`/vendor/shenai/`); la app, que maneja la sesión y los datos de salud, funciona
   sin él.
2. **Recuperación.** Después de una medición o de un error, el marco se descarta (primero se apaga el SDK, después se
   quita la página). El siguiente intento arranca con un SDK nuevo.
3. **Memoria.** Al descartar el marco se liberan el motor (~36 MB) y sus modelos.
4. **Acople simple.** Para conectar otro SDK alcanza con otra página que publique el mismo contrato.

El contrato (`scan/marco/contrato.ts`) es un objeto que la página publica en `window.serenaEscaneo`:

```ts
window.serenaEscaneo = {
  version: 1,
  motor: 'shenai-3',
  crear: (opciones) => proveedor, // un ScanProvider con liberar()
};
```

`opciones` trae la escala de estrés, la credencial (función que pide el token al servidor) y el diagnóstico. La
cámara la abre la app y se la pasa al módulo como objeto; por eso el marco tiene que ser del mismo origen. Toda la
página del módulo es `scan/marco/anfitrion.ts` (15 líneas).

Estado: verificado con el SDK real 3.1.15 y cámara simulada (inicialización, medición, descarte y reintento con un
SDK nuevo). **Falta la prueba en un teléfono**; por eso viene apagado.

## Cómo verificar un cambio

```
npm run typecheck          # tipos de todo el proyecto
npx vitest run <archivo>   # la prueba del módulo que se tocó
npm test                   # todas las unitarias
npm run e2e                # recorridos completos en el navegador
```
