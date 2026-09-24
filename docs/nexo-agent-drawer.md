# Nexo — especificación portable del drawer de configuración

Documento para clonar exactamente el panel lateral de **Configuración del agente** que aparece sobre el dashboard.

## 1. Qué es

Es un drawer lateral derecho de pantalla completa que permite editar la identidad y el comportamiento del agente sin abandonar el dashboard.

Características principales:

- entra desde el borde derecho;
- oscurece el dashboard con un overlay;
- conserva el contexto visual del dashboard detrás;
- tiene scroll interno independiente;
- mantiene el botón de cierre fijo arriba a la derecha;
- muestra el orbe grande del modelo entre el encabezado y el formulario;
- permite editar negocio, tono, instrucciones, estado, modelo y token;
- permite probar el agente desde el mismo panel;
- se adapta a light mode y dark mode;
- en móvil ocupa todo el ancho.

## 2. Estructura exacta

```text
drawer-root                         fixed, viewport completo
├── drawer-overlay                  fondo oscuro detrás
└── drawer-panel                    panel derecho
    ├── drawer-close                botón X fijo
    └── drawer-scroll               única zona scrolleable
        ├── drawer-header
        │   ├── eyebrow: CONFIGURACIÓN DEL AGENTE
        │   ├── title: La lógica de tu agente.
        │   └── description
        ├── drawer-orb-wrap
        │   ├── FluidOrb 190px
        │   └── modelo seleccionado
        └── AgentView
            ├── intro y botón Guardar cambios
            ├── card Identidad y comportamiento
            └── card Control
                ├── Agente activo
                ├── selector de proveedor/modelo
                ├── Token de acceso
                └── Probar agente
```

## 3. Montaje y transición

```tsx
<AnimatePresence>
  {open && (
    <motion.div
      className="drawer-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        className="drawer-overlay"
        aria-label="Cerrar configuración"
        onClick={() => onOpenChange(false)}
      />

      <motion.div
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: .28, ease: [0.22, 1, 0.36, 1] }}
      >
        ...contenido...
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

El overlay y el panel deben animarse juntos. El overlay hace fade; el panel entra horizontalmente desde la derecha. No usar `display: none` mientras la salida está animando: `AnimatePresence` debe conservar el nodo hasta completar el exit.

## 4. CSS base exacto

```css
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  justify-content: flex-end;
}

.drawer-overlay {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, .38);
  cursor: default;
}

.drawer-panel {
  position: relative;
  z-index: 1;
  width: min(620px, calc(100vw - 18px));
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  box-shadow: -20px 0 60px rgba(0, 0, 0, .18);
}

.drawer-close {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--card);
  color: var(--ink);
}

.drawer-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding: 0 26px 34px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.drawer-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
```

La combinación `height: 100%` + `overflow: hidden` en el panel y `min-height: 0` + `overflow-y: auto` en el scroll es obligatoria. Evita que el contenido rompa la pantalla y evita que el drawer se desplace junto con el dashboard.

## 5. Header

```css
.drawer-header {
  padding: 34px 62px 20px 26px;
  border-bottom: 1px solid var(--line);
}

.drawer-title {
  margin-top: 8px;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -.05em;
}

.drawer-description {
  max-width: 430px;
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
```

Contenido exacto:

```text
CONFIGURACIÓN DEL AGENTE
La lógica de tu agente.
Definí cómo habla, qué puede hacer y cuándo derivar una conversación.
```

El padding derecho es mayor porque el botón X está superpuesto en la esquina. El texto nunca debe quedar debajo del botón.

## 6. Orbe y modelo

```css
.drawer-orb-wrap {
  display: grid;
  place-items: center;
  gap: 7px;
  padding: 20px 0 10px;
}

.drawer-orb-wrap span {
  color: var(--muted);
  font: 10px 'DM Mono', monospace;
  letter-spacing: .04em;
  text-transform: uppercase;
}
```

Uso:

```tsx
<div className="drawer-orb-wrap">
  <FluidOrb size={190} color="#2D5FD6" />
  <span aria-live="polite">LING-3.0-FLASH-FIN-FREE</span>
</div>
```

El orbe es el mismo shader WebGL propio usado en el chat. No reemplazarlo por una imagen estática: la mezcla de blanco y azul, el movimiento orgánico y la máscara circular son parte de la identidad visual.

## 7. Formulario de identidad

La primera tarjeta contiene:

```text
Identidad y comportamiento
Definí cómo debe representar a tu negocio.

Nombre del negocio
[ Infralar ]

Tono de voz
[ Claro, consultivo, directo y humano; profesional, simple y orientado ... ]

Instrucciones principales
[ textarea larga ]
Escribí qué puede hacer, qué no debe inventar y cuándo derivar a una persona.
El agente no actuará fuera de estas instrucciones.
```

CSS de campos:

```css
.settings {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 7px;
}

.field label {
  font-size: 12px;
  font-weight: 700;
}

.field small {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 11px 12px;
  outline: none;
  background: var(--card);
  color: var(--ink);
}

.field textarea {
  min-height: 104px;
  resize: vertical;
  line-height: 1.5;
}
```

La tarjeta usa el patrón estándar:

```css
.card {
  border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  border-radius: 16px;
  padding: 23px;
  background: var(--card);
  color: var(--ink);
}
```

Dentro del drawer, las tarjetas no deben tener una sombra fuerte porque el panel ya tiene profundidad propia:

```css
.drawer-scroll .card {
  box-shadow: none;
}
```

## 8. Tarjeta Control

La segunda tarjeta contiene, en este orden:

1. **Agente activo** con switch.
2. Selector de proveedor/modelo con búsqueda.
3. Metadata técnica del modelo.
4. Token de acceso como password input.
5. Bloque `Probar agente`.
6. Textarea para mensaje de prueba.
7. Botón `Enviar prueba`.
8. Resultado de la prueba, si existe.

Switch:

```css
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 0;
  border-top: 1px solid var(--line);
}

.toggle {
  width: 42px;
  height: 24px;
  padding: 3px;
  border: 0;
  border-radius: 20px;
  background: #d4d5cf;
}

.toggle.on {
  background: var(--electric-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--electric-blue) 18%, transparent);
}
```

Bloque de prueba:

```css
.agent-test {
  display: grid;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.agent-test-result {
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--soft);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.5;
}
```

## 9. Guardado y prueba

El botón superior `Guardar cambios` y la configuración deben usar estado controlado.

```ts
type AgentConfig = {
  businessName: string;
  tone: string;
  instructions: string;
  enabled: boolean;
  model: string;
  apiKey: string;
};
```

Al guardar:

1. enviar `PUT /api/config`;
2. enviar sólo los campos editables;
3. mostrar toast de éxito o fallback local;
4. no cerrar el drawer automáticamente;
5. mantener el scroll y los valores visibles.

Al probar:

1. no ejecutar si el mensaje está vacío;
2. activar estado `Probando…` y deshabilitar el botón;
3. enviar `POST /api/agent` con `business`, `model`, `apiKey` y mensaje;
4. mostrar el texto devuelto y el proveedor si existe;
5. en error mostrar un resultado legible, sin romper el drawer;
6. restablecer el botón al finalizar, incluso si falla la petición.

## 10. Dark mode

El drawer no crea una paleta propia. Consume los tokens globales:

```css
.theme-dark .drawer-panel {
  background: var(--paper); /* #1E1E1E */
  color: var(--ink);        /* #F5F5EF */
  border-color: var(--line); /* #303030 */
}

.theme-dark .drawer-close {
  background: var(--card);  /* #272727 */
  color: var(--ink);
}
```

El overlay puede mantener `rgba(0, 0, 0, .38)`: oscurece el dashboard sin volver ilegible el drawer.

## 11. Responsive

```css
@media (max-width: 620px) {
  .drawer-panel { width: 100%; }
  .drawer-header { padding-left: 20px; }
  .drawer-scroll {
    padding-right: 20px;
    padding-left: 20px;
  }
}
```

En móvil:

- el drawer ocupa `100vw`;
- el close sigue arriba a la derecha;
- el header conserva espacio derecho para el close;
- el scroll sigue siendo interno;
- el orbe puede mantenerse en `190px` mientras entre en el viewport;
- inputs y textareas nunca deben desbordar horizontalmente.

## 12. Edge cases

- Click en overlay: cierra el drawer.
- Click en X: cierra el drawer.
- Escape: debe cerrar si se implementa focus management.
- Scroll largo: sólo se desplaza `.drawer-scroll`, nunca el body del dashboard.
- Cierre durante una petición: no cancelar la petición sin una estrategia; conservar el resultado y mostrarlo al reabrir.
- Guardado fallido: conservar los valores editados y mostrar error; no revertir silenciosamente.
- Token vacío: permitir guardar configuración, pero bloquear o explicar la prueba del modelo.
- Prueba doble: deshabilitar el botón durante la petición.
- Textarea muy larga: usar resize vertical sin romper el ancho del panel.
- Reduced motion: reemplazar el slide/fade por una aparición instantánea o transición mínima.
- Teclado: focus visible en close, inputs, selector, textarea y botones.
- Overlay no debe capturar clicks destinados al panel.

## 13. Checklist de clonación

- [ ] Drawer derecho de `620px` máximo.
- [ ] Overlay negro al `38%`.
- [ ] Entrada desde `x: 100%` con duración `.28s`.
- [ ] Header con eyebrow, título y descripción exactos.
- [ ] Close de `34px` en esquina superior derecha.
- [ ] Orbe WebGL de `190px`, color `#2D5FD6`.
- [ ] Modelo en DM Mono uppercase debajo del orbe.
- [ ] Scroll interno sin scrollbar visible.
- [ ] Dos tarjetas sin sombra fuerte dentro del drawer.
- [ ] Formulario controlado y persistente.
- [ ] Selector de modelo con búsqueda.
- [ ] Prueba con loading y manejo de error.
- [ ] Light/dark mode usando los mismos tokens globales.
- [ ] Drawer full width debajo de `620px`.

## 14. Fuente de verdad

- Componente estructural: `components/ui/drawer.tsx`.
- Integración y contenido: `app/page.tsx`, `AgentView`.
- Estilos: `app/globals.css`, selectores `.drawer-*`, `.settings`, `.field` y `.agent-test`.
- Orbe: `components/ui/fluid-orb.tsx`.
- Tokens y fuentes: `docs/nexo-visual-spec.md`.
