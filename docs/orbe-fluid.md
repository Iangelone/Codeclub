# Orbe fluido y paleta compartida

El orbe de Codeclub es una esfera animada dibujada con WebGL. Su patrón —una zona blanca y otra azul con una frontera de nubes irregulares— se genera proceduralmente en el shader; no es una textura ni una imagen rasterizada. El componente reutilizable está en `src/components/ui/fluid-orb.tsx`.

## Arquitectura

- **`FluidOrb`** dibuja el orbe y conserva la API visual: `size`, `color`, `shape`, `animateOnHover` y `active`. Usa WebGL cuando está disponible y un degradado CSS de respaldo si no se puede crear o compilar el shader.
- **`OrbPaletteProvider`** (`src/components/OrbPaletteProvider.tsx`) mantiene el color global, la paleta siguiente y la persistencia. Envuelve la aplicación desde `src/app/layout.tsx`; cualquier consumidor de `useOrbPalette()` debe estar dentro de ese provider.
- **`OrbPaletteButton`** (`src/components/ui/OrbPaletteButton.tsx`) presenta un orbe clickeable, con etiqueta accesible que anuncia el próximo color. Al activarlo, avanza la paleta global. El clic no roba el foco del campo de texto y no inicia el arrastre del widget.
- **Motion** anima el filtro de tono del orbe, las variables CSS de la aplicación y la respuesta de escala del botón. Se respeta `prefers-reduced-motion` en las transiciones.

El orbe usado como selector muestra la paleta actual. Otros usos de `FluidOrb` dentro del árbol del provider también reciben el filtro global, aunque no sean botones.

## Cómo se genera el patrón

1. El vertex shader dibuja un rectángulo que cubre el canvas.
2. El fragment shader crea ruido procedural con `hash`, `noise` y tres octavas de `fbm`. Dos campos de ruido deforman un tercero (`warp`) mientras `u_time` desplaza lentamente el patrón.
3. En forma circular, `gradient`, `anchor` y `shade` mantienen el blanco en la parte superior y el azul en la inferior, con una frontera orgánica. El factor `(fluid - 0.5) * 0.8` controla cuánto se ondula esa frontera. No reemplazar estos cálculos por un corte horizontal plano: son la identidad visual del orbe.
4. Las coordenadas UV se convierten en un disco. Los píxeles fuera del radio se descartan y `sqrt(1.0 - radiusSquared)` reconstruye profundidad y normal de la superficie.
5. La luz difusa, el reflejo especular y el borde suave dan volumen sin tapar el patrón. Mantener `diffuse`, `specular` y `rim` sutiles.

La forma `rect` conserva el degradado rectangular y no aplica máscara ni sombreado esférico. `color` se recibe como hex y `hexToRgb` lo convierte a RGB para `u_color`.

## Paletas y superficies sincronizadas

Las nueve paletas están definidas en `ORB_PALETTES`, en este orden cíclico:

| Índice | Nombre | Tono de esfera (`orb`) | Acento (`accent`) |
| ---: | --- | --- | --- |
| 0 | Azul | `#2D5FD6` | `#3D9BFF` |
| 1 | Rojo | `#D63D52` | `#F04E65` |
| 2 | Amarillo | `#D6A317` | `#E8B930` |
| 3 | Violeta | `#7543D6` | `#9C6AFF` |
| 4 | Verde | `#21845A` | `#39B77C` |
| 5 | Naranja | `#D6752B` | `#F0893A` |
| 6 | Rosa | `#D64A9E` | `#F15BB9` |
| 7 | Cian | `#228FAD` | `#31B4D5` |
| 8 | Lima | `#8CAB20` | `#B4D43A` |

Cada entrada también tiene `bright` para los acentos claros, `electric` para variables eléctricas de la UI, y `hue` para transformar el shader con CSS. El hue-rotate mantiene el blanco blanco y recolorea la parte pigmentada y el fallback. Si se agregan o reordenan paletas, actualizar pruebas/referencias visuales y mantener los índices válidos en el proceso principal.

Los botones actuales se encuentran en:

- **Input principal:** `ChatInterface.tsx`.
- **Widget flotante:** botón del orbe plegado y botón del composer en `FloatingChat.tsx`.
- **Estado vacío del workspace:** `WorkspaceLayout.tsx`.
- **Vista previa:** `src/app/orb-preview/page.tsx`.

La paleta cambia desde cualquiera de estos botones y se actualizan juntos los demás orbes, acentos, bordes y superficies con degradado. Los estilos relevantes están en `src/app/globals.css` y `src/components/floating-chat.css`:

- `--nexo-orb-blue`: tono principal para composer, graphite y algunos fondos.
- `--codeclub-accent` y `--codeclub-accent-bright`: bordes, estados de foco y acentos.
- `--electric-blue` y `--nexo-electric-blue`: detalles eléctricos de la interfaz.
- `--codeclub-chat-glow`: color con alpha usado en el resplandor radial de conversación y widget.

Las variables se animan en el wrapper `motion.div` del provider. Para que un degradado interpolable responda al cambio, referenciar estas variables dentro de la regla del componente (no calcularlo una sola vez en `:root`). `@property` registra las variables de color animadas. Al introducir un nuevo fondo temático, conectarlo a la variable adecuada en lugar de hardcodear azul.

## Persistencia y eventos

- La clave de `localStorage` es `codeclub:orb-palette-index`. Se guarda un entero de `0` a `8`; valores ausentes o inválidos vuelven al índice `0` (azul).
- El provider aplica el índice inicial al montar y mantiene una referencia sincrónica para que varios clics rápidos no salten ni se pierdan.
- El evento renderer `codeclub:orb-palette-change` lleva `CustomEvent` con `detail: { index: number }`. `cyclePalette` persiste, actualiza la UI local y lo despacha.
- El evento del navegador `storage` sincroniza pestañas del mismo origen.
- Como el widget puede vivir en otra ventana Electron, `window.codeclub.broadcastOrbPalette(index)` manda el IPC `codeclub:orb-palette-change` mediante `electron/preload.cjs`. `electron/main.ts` solo retransmite índices enteros del rango `0–8` a otras ventanas activas; cada preload recibe el índice y el provider lo transforma en el evento renderer local.
- Los listeners DOM, `storage` e IPC se registran en el mismo `useEffect` del provider y se limpian en su retorno. El preload devuelve una función de unsubscribe para retirar su listener IPC.

Al cambiar el rango o el nombre de un canal, actualizar conjuntamente la normalización del provider y la validación IPC en `electron/main.ts`. Los eventos internos deben mantener el prefijo `codeclub:` y documentar emisor, payload, consumidores y limpieza aquí.

## Rendimiento, compatibilidad y movimiento

- El canvas limita DPR a `2`, usa `requestAnimationFrame` y `IntersectionObserver`, y detiene el dibujo cuando la ventana/pestaña está oculta, el canvas sale del viewport, `active` es falso o el movimiento está reducido.
- `animateOnHover` restringe la animación procedural al hover. No activar animación continua para orbes decorativos fuera de vista.
- Si WebGL, el programa o el shader fallan, `FluidOrb` muestra un degradado CSS. Mantener este fallback al editar el componente.
- El filtro de color y las transiciones usan Motion; ante movimiento reducido, sus transiciones se llevan a duración cero y el botón omite escalado hover/tap.
- Los botones deben conservar `aria-label` y `title` traducidos, un indicador visible de foco y el área clickeable apropiada para cada tamaño.

## Cómo cambiar el aspecto

- **Más o menos nubes:** ajustar `(fluid - 0.5) * 0.8` en `shade`; un valor mayor ondula más la frontera.
- **Velocidad:** ajustar `u_time * 0.22` y el desplazamiento `drift`.
- **Volumen:** modificar primero `diffuse`; conservar `specular` y `rim` bajos.
- **Color o paleta:** editar `ORB_PALETTES` y probar que el orbe, los acentos y los degradados cambien juntos desde cada ubicación.
- **Transición de color:** ajustar la duración/easing Motion en el provider y en `FluidOrb`; mantenerlas coordinadas para que esfera y fondos se sientan como un solo cambio.
- **Tamaño y forma:** pasar `size` y `shape` al componente compartido. No duplicar ni copiar el shader por superficie.

## Vista previa y verificación

Ejecutar `npm run next:dev` y abrir `http://127.0.0.1:3000/orb-preview` (usar el puerto que informe Next si el 3000 ya está ocupado). La página incluye un orbe interactivo y el glow de fondo. Probar los nueve pasos hasta volver a azul, la persistencia al recargar y la sincronización en otra pestaña; en Electron, comprobar además la sincronización con la ventana del widget.

Para cambios en el shader o en la paleta, ejecutar las verificaciones habituales del proyecto: `npm run next:build`, `npm run electron:compile` y `git diff --check`. Revisar visualmente el patrón, el fallback, los degradados y el comportamiento con movimiento reducido.
