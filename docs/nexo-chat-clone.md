# Nexo — especificación portable del chat del asistente

Este documento describe el chat inferior de Nexo para clonarlo en otra aplicación con el mismo comportamiento visual y de interacción. No es un chat genérico: reproduce el dock flotante, su expansión, la última interacción, los borradores y el flujo de aprobación.

## 1. Objetivo

Construir un asistente flotante centrado en la parte inferior de la pantalla que:

- permanece disponible sobre cualquier sección del CRM;
- inicia compacto como una pill de input;
- se expande cuando el usuario enfoca el input o abre la actividad;
- muestra la última respuesta del agente en Markdown;
- permite copiar la respuesta completa;
- muestra borradores editables con acciones `Guardar`, `Borrar` y `Aceptar`;
- nunca envía un mensaje de WhatsApp sin aprobación explícita;
- conserva la respuesta y su estado entre recargas;
- soporta dark mode y light mode sin perder contraste.

## 2. Estructura visual

La jerarquía debe ser exactamente ésta:

```text
floating-assistant
├── panel de última interacción       (sólo abierto)
│   ├── header
│   │   ├── título: Última interacción
│   │   ├── badge de estado
│   │   └── botón copiar
│   ├── response con Markdown          (scroll interno si es larga)
│   └── drafts                         (si existen borradores)
│       ├── título: Borradores para revisar
│       └── draft x N
│           ├── destinatario
│           ├── textarea
│           └── Guardar / Borrar / Aceptar
├── pill de input                      (siempre visible)
│   ├── orbe de 22px
│   ├── input
│   └── botón circular enviar
└── control de colapso                  (arriba del panel/input)
```

El control de colapso debe estar unido al borde superior del conjunto. No debe quedar flotando sobre el textarea ni dejar un hueco al abrir/cerrar.

## 3. Dimensiones y CSS base

```css
.floating-assistant {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 25;
  width: 440px;
  max-width: calc(100vw - 28px);
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  gap: 0;
  pointer-events: none;
}

.floating-assistant-panel,
.floating-assistant-pill,
.floating-assistant-collapse {
  pointer-events: auto;
}

.floating-assistant-panel {
  order: 1;
  width: 100%;
  overflow: hidden;
  border: 1px solid #d8d8d1;
  border-bottom: 0;
  border-radius: 16px 16px 0 0;
  background: #fff;
  color: var(--ink);
}

.floating-assistant-pill {
  order: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 48px;
  padding: 0 15px;
  border: 1px solid #d8d8d1;
  border-radius: 0 0 16px 16px;
  background: #fff;
}

.floating-assistant:not(.is-open) .floating-assistant-pill {
  border-radius: 999px;
}

.floating-assistant.is-open .floating-assistant-pill {
  border-top: 0;
}

.floating-assistant-collapse {
  order: 0;
  width: 42px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 1px solid #d8d8d1;
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
  background: #fff;
}
```

### Responsive

```css
@media (max-width: 620px) {
  .floating-assistant {
    width: min(440px, calc(100vw - 20px));
    bottom: max(12px, env(safe-area-inset-bottom));
  }
}
```

El ancho expandido es `560px`, pero nunca puede superar `calc(100vw - 28px)`.

## 4. Estado del componente

```ts
type InteractionStatus = 'pendiente' | 'completada' | 'fallo';

type MessageDraft = {
  id: string;
  remote_jid: string;
  body: string;
  status: 'draft' | 'approved';
};

type ChatState = {
  open: boolean;
  input: string;
  interaction: string;
  interactionStatus: InteractionStatus;
  copied: boolean;
  inputFocused: boolean;
  draftBodies: Record<string, string>;
};
```

Regla de expansión:

```ts
const expanded = open || inputFocused;
const width = expanded ? 560 : 440;
```

Esto significa que al enfocar el input el dock se amplía inmediatamente, incluso si el panel de actividad está cerrado. Al perder el foco vuelve a su tamaño normal sólo si también está cerrado.

## 5. Estados y transiciones

### Cerrado

- Se ve sólo el pill de input y el control superior.
- El control muestra chevron hacia arriba y tiene `aria-label="Mostrar última interacción"`.
- Si no hay interacción ni borradores, el control está deshabilitado.
- El pill mide `48px` y tiene radio `999px`.

### Abierto

- Se monta el panel sólo si `open` es verdadero y existe interacción o al menos un borrador.
- El control muestra chevron hacia abajo y `aria-label="Ocultar última interacción"`.
- El panel aparece con `opacity: 0, y: 10, scale: .96` y anima a `opacity: 1, y: 0, scale: 1`.
- El cierre es inmediato para que el panel no quede flotando un frame después del input.

### Focus del input

- `inputFocused = true`.
- Se expande a `560px` con spring.
- Si hay interacción o borradores, abre también el panel.
- Al perder focus no se borra el texto ni se cierra el panel automáticamente.

### Envío

1. Interceptar `submit` del formulario.
2. Ejecutar `trim()` para validar.
3. Si queda vacío, no hacer nada.
4. Vaciar el input inmediatamente antes del `await` para evitar que el texto viejo permanezca visible.
5. Cambiar estado a `pendiente`.
6. Ejecutar `onSend(message)`.
7. Si llega texto, mostrarlo como nueva interacción.
8. Si el texto comienza con `**Error:**`, usar estado `fallo`; en otro caso usar `completada`.
9. Persistir texto y estado.
10. Mantener abierto el panel si existe respuesta o interacción previa.

Pseudocódigo:

```ts
async function submit(event: SubmitEvent) {
  event.preventDefault();
  const message = input.trim();
  if (!message) return;

  setInput('');
  setInteractionStatus('pendiente');

  const response = await onSend(message);
  if (typeof response === 'string' && response.trim()) {
    setInteraction(response);
    setInteractionStatus(
      response.trimStart().startsWith('**Error:**') ? 'fallo' : 'completada'
    );
    persistInteraction(response, status);
  }

  setOpen(Boolean(response || interaction.trim()));
}
```

Nunca esperar la respuesta del servidor antes de limpiar el input. Esto evita el bug visual de Enter donde el mensaje queda pegado durante la petición.

## 6. Input

```css
.floating-assistant-pill input {
  min-width: 0;
  flex: 1;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
}

.floating-assistant-pill input::placeholder {
  color: var(--muted);
  opacity: 1;
}
```

- Placeholder exacto: `Decime qué querés hacer…`.
- El input debe permitir Enter para enviar.
- El botón enviar es circular, `26px`, y se deshabilita cuando `input.trim()` está vacío.
- El botón usa `ArrowUp` de Lucide, `17px`.
- Al invocar una acción “Usar número en el asistente”, se debe pasar el número al prop `prefill`, cargarlo en el input y enfocarlo automáticamente.
- `prefill` no debe convertir un mensaje vacío en un submit accidental.

## 7. Orbe del chat

Usar el mismo `FluidOrb` documentado en la especificación visual:

```tsx
<FluidOrb size={22} color="#2D5FD6" />
```

El wrapper mide `22px`, tiene `overflow: hidden` y radio circular. El orbe tiene una animación muy leve de rotación:

```tsx
animate={{ rotate: [0, -12, 12, 0] }}
transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 3.5 }}
```

Debe respetarse `prefers-reduced-motion` para evitar movimiento constante en usuarios que lo desactivaron.

## 8. Panel de respuesta

```css
.floating-assistant-response {
  max-height: min(280px, calc(100vh - 260px));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  touch-action: pan-y;
  margin: 0;
  padding: 13px 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
  scrollbar-width: none;
}
```

Comportamiento obligatorio:

- La respuesta crece naturalmente hasta `280px`.
- Después de `280px`, se hace scroll dentro del panel, no en toda la página.
- El scroll debe funcionar con mouse wheel, trackpad, touch y teclado.
- No usar `overflow: hidden` en el contenedor de respuesta.
- `:first-child` y `:last-child` no deben agregar espacios artificiales.
- Renderizar Markdown: párrafos, listas, strong, inline code y bloques de código.
- Los bloques `pre` pueden tener su propio overflow horizontal.

El header:

```css
.floating-assistant-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
  font-weight: 600;
}
```

## 9. Estado de interacción

El badge debe ser plano, sólido y legible en ambos temas:

```css
.floating-assistant-status {
  display: inline-flex;
  align-items: center;
  min-height: 19px;
  padding: 0 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--electric-blue);
  font-size: 10px;
  font-weight: 700;
  text-transform: lowercase;
}
```

Los tres estados (`pendiente`, `completada`, `fallo`) conservan el mismo azul eléctrico para que el estado no cambie el lenguaje visual ni pierda contraste.

## 10. Borradores

Los borradores sólo se crean para revisar; el agente nunca debe enviarlos automáticamente.

```css
.floating-assistant-drafts {
  border-top: 1px solid var(--line);
  padding: 12px 14px 14px;
}

.floating-assistant-draft {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(127, 127, 127, .08);
}

.floating-assistant-draft textarea {
  display: block;
  width: 100%;
  min-height: 68px;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--card);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.4;
}
```

Acciones, alineadas a la derecha:

```css
.floating-assistant-draft-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}
```

Orden visual obligatorio:

```text
Guardar   Borrar   Aceptar
                          ↑ azul eléctrico / acción principal
```

- `Guardar`: persiste la edición del texto.
- `Borrar`: descarta el borrador y no envía nada.
- `Aceptar`: aprueba y envía el texto actual del textarea.
- El botón `Aceptar` es el único primario y usa `--electric-blue` con texto blanco.
- El estado local `draftBodies[id]` debe mantenerse separado por ID para que editar un borrador no cambie los demás.
- Después de cualquier acción, refrescar la lista de borradores desde el backend.

## 11. Persistencia

Persistir la última interacción y su estado:

```ts
const LAST_INTERACTION_STORAGE_KEY = 'infralar.last-owner-interaction';
const LAST_INTERACTION_STATUS_STORAGE_KEY = 'infralar.last-owner-interaction-status';
```

Secuencia de carga:

1. Leer localStorage para mostrar una respuesta inmediatamente.
2. Consultar `GET /api/agent/interaction` sin cache.
3. Si Supabase tiene texto, reemplazar el fallback local.
4. Si Supabase está vacío pero existe fallback local, intentar sincronizarlo con `PUT`.
5. Si localStorage está bloqueado, la interfaz sigue funcionando en memoria.

API mínima:

```text
GET /api/agent/interaction
PUT /api/agent/interaction
body: { text: string, status?: 'pendiente' | 'completada' | 'fallo' }
```

El `PUT` debe responder sin bloquear el render del chat. Una falla de persistencia no debe borrar la respuesta visible.

## 12. API del contenedor

```ts
type FloatingAssistantProps = {
  lastInteraction?: string;
  onSend?: (message: string) => Promise<string | void> | string | void;
  drafts?: MessageDraft[];
  onDraftAction?: (
    id: string,
    action: 'edit' | 'reject' | 'send',
    text?: string
  ) => Promise<void>;
  prefill?: string;
};
```

El componente no debe conocer la lógica de negocio de WhatsApp. El padre decide cómo responde `onSend` y cómo persiste `onDraftAction`.

Para el agente propietario, el padre envía:

```json
{
  "message": "texto del input",
  "mode": "owner",
  "model": "modelo seleccionado",
  "business": {
    "name": "nombre del negocio",
    "tone": "tono",
    "instructions": "instrucciones"
  },
  "context": "métricas, conversaciones y actividad"
}
```

## 13. Edge cases obligatorios

- **Enter durante una petición:** limpiar input antes del `await`; evitar doble submit con estado de envío si se agregan reintentos.
- **Respuesta vacía:** conservar la interacción anterior y mostrar un fallback, no abrir un panel vacío.
- **Error del agente:** mostrar `**Error:** ...`, estado `fallo` y permitir un nuevo intento.
- **Respuesta muy larga:** scroll sólo dentro de `.floating-assistant-response` después de `280px`.
- **Muchos borradores:** el panel completo debe poder desplazarse o el área de drafts debe tener una estrategia clara; nunca cortar botones fuera del viewport.
- **Viewport pequeño:** limitar ancho a `calc(100vw - 20px)` en móvil.
- **Teclado móvil:** respetar `safe-area-inset-bottom`.
- **Abrir y cerrar rápido:** el cierre del panel debe tener transición de salida de duración `0` para no dejarlo flotando.
- **Focus y blur:** perder focus no debe borrar el input ni colapsar el panel si sigue abierto.
- **Prefill repetido:** sólo enfocar y reemplazar cuando llega un valor no vacío.
- **Clipboard bloqueado:** fallar silenciosamente y no romper el chat.
- **localStorage bloqueado:** usar estado en memoria y continuar renderizando.
- **reduced motion:** desactivar springs, rotación continua y scroll suave.
- **Borrador aprobado:** refrescar la lista para que desaparezca o cambie de estado sin duplicarlo.
- **WhatsApp desconectado:** no enviar; mostrar el error en el flujo de aprobación y conservar el borrador.

## 14. Checklist de clonación

- [ ] El dock cerrado mide `440px` y el abierto `560px`.
- [ ] El input se limpia instantáneamente al enviar con Enter.
- [ ] Al enfocar input se expande aunque el panel esté cerrado.
- [ ] El botón superior queda unido al borde del panel/pill.
- [ ] La respuesta larga hace scroll dentro del chat.
- [ ] El status es azul eléctrico sólido y legible en ambos temas.
- [ ] El Markdown conserva listas, énfasis y código.
- [ ] Los borradores son editables y tienen `Guardar`, `Borrar`, `Aceptar`.
- [ ] `Aceptar` es el botón azul y está a la derecha.
- [ ] No se envía ningún borrador sin click explícito en `Aceptar`.
- [ ] El último mensaje sobrevive a un reload.
- [ ] El layout respeta reduced motion, mobile y safe area.

## 15. Fuente de verdad del proyecto original

- Componente: `components/ui/floating-assistant.tsx`.
- Estilos: `app/globals.css`, selectores `.floating-assistant*`.
- Orbe: `components/ui/fluid-orb.tsx`.
- Integración y llamadas API: `app/page.tsx`.
- Persistencia: `/api/agent/interaction` y `/api/drafts`.
- Sistema de colores y fuentes: `docs/nexo-visual-spec.md`.
