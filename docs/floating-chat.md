# Chat flotante

La X oculta la ventana principal y muestra una ventana Electron transparente,
sin marco, siempre visible por encima de otras ventanas y fuera de la barra de
tareas. Comparte origen, preload y ChatInterface con la ventana principal.
Su conversación es global; no hereda silenciosamente el proyecto activo.

El widget mide 460 px de ancho. El input expande la ventana a 300 px; Escape o
el botón de contraer vuelven a 84 px, incluyendo el marco negro y el asa de
arrastre siempre visible. El input tiene 40 px de alto en una línea (38 px
interiores más borde), con 6 px de padding vertical. El orbe de 24 px está
dentro del input negro #161616,
a la izquierda. La conversación y el borrador se conservan mientras la ventana está
oculta. Inicio abre Codeclub; la bandeja también lo abre y oculta el flotante.
Salir desde la bandeja destruye ambas ventanas. No se cambia el comportamiento
del botón de minimizar.

El menú de bandeja incluye Widget como interruptor sin check, alineado con las
opciones Abrir y Salir.
Activarlo oculta la ventana principal; desactivarlo oculta el widget. Abrir
Codeclub desactiva Widget. La X vuelve a activarlo automáticamente.

Se arrastra desde el orbe o el asa superior. Electron limita los bounds al área
de trabajo del monitor, ancla al borde superior o inferior según el centro de
la ventana y conserva el borde durante los cambios de altura. Guarda posición
y anclaje en floating-position.json. Reajusta al cambiar o retirar monitores.

## Halo azul difuminado

El efecto del fondo se dibuja en `src/components/floating-chat.css`, en
`.floating-surface`, mediante un degradado radial suave sobre una base oscura:

```css
background:
  radial-gradient(ellipse at 30% 110%, #2d5fd633, transparent 55%),
  #111315;
```

La elipse se centra al 30% del ancho y al 110% de la altura: el centro queda
ligeramente por debajo del panel y el halo entra desde su borde inferior.
El azul pierde intensidad gradualmente hasta ser transparente al 55% del
radio. Esa caída suave produce el aspecto difuminado de la captura.

`#2D5FD6` es el mismo azul que recibe `FluidOrb` en `FloatingChat.tsx`.
El sufijo hexadecimal `33` aplica un 20% de opacidad al halo, conservando
el fondo negro y la legibilidad del chat. El indicador del modelo usa ese
mismo azul y una sombra `0 0 8px #2d5fd640` (25% de opacidad).

El borde `#202020`, el radio de 22 px y `overflow: hidden` recortan el halo
dentro del panel. La sombra exterior `0 4px 12px #0006` pertenece al marco
`.floating-shell`. El input conserva su superficie independiente `#161616`.
El modo compacto usa el fondo sólido `#080808`; el halo aparece al expandir.

Para ajustar la intensidad, cambiar únicamente el alfa `33`; para modificar
la extensión, ajustar el punto transparente `55%` y la posición de la elipse.
Mantener el RGB `2d5fd6` sincronizado con el color del orbe.

## Eventos y bridge

- `codeclub:floating-drag`: invoke del asa y el orbe, payload de fase
  start/move/end y coordenadas de pantalla del evento. Electron verifica el
  emisor, valida coordenadas y limita el desplazamiento al monitor.
  Pointer capture conserva el gesto y libera al terminar;
  el proceso principal ancla y guarda la posición al finalizar.

- `codeclub:floating-resize`: invoke de preload desde FloatingChat, payload
  boolean de expansión. El proceso principal verifica el webContents emisor.
- `codeclub:floating-open-main`: invoke desde el botón Inicio, sin payload.
  Solo admite el emisor de la ventana flotante.
- `codeclub:floating-show`: el proceso principal lo envía al revelar el
  flotante, sin payload. FloatingChat invalida la caché de ajustes y actualiza
  el idioma. Su useEffect retira la suscripción de preload al desmontarse.
- `codeclub:main-show`: el proceso principal lo envía al abrir la ventana
  principal, sin payload. HomePage refresca ajustes y la lista de chats
  globales; retira la suscripción al desmontarse.
- `codeclub:settings-changed`: HomePage y FloatingChat lo emiten sin payload
  al revelar una ventana. ChatInterface restaura proveedor y modelo y retira
  su listener en el mismo useEffect. HomePage también invalida la caché ante
  `storage` entre ventanas y propaga el evento compartido de idioma.
- `codeclub:open-empty-chat`: evento existente, emitido por el botón + del
  flotante. ChatInterface conserva su registro y limpieza en el mismo efecto.

El chat conserva el motor, selección visual de modelos, adjuntos, credenciales,
cancelación, aprobación de herramientas y persistencia existentes. No introduce
una segunda implementación de IA ni guarda credenciales en artefactos.

## Verificación manual

Cerrar con X; escribir desde la barra compacta; enviar con Enter; abrir el
selector de modelo; contraer; arrastrar desde el orbe a ambos bordes; reabrir
desde Inicio y la bandeja; comprobar conversación global y borrador; alternar
idioma; verificar proyecto principal y terminal sin cambios. Para una respuesta
real se requiere una credencial válida del proveedor seleccionado.
