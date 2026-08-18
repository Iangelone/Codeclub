# Flujos y eventos

## Un mensaje normal

1. El usuario escribe en `ChatInterface`.
2. Se agrega el mensaje al chat activo.
3. El agente recibe el proyecto actual y el catálogo de tools.
4. AI SDK transmite la respuesta y las llamadas a tools.
5. Cada tool ejecuta trabajo local o pide IPC.
6. El resultado vuelve al chat y puede abrir un panel.
7. Uso, resultado y errores quedan disponibles para auditoría.

```text
prompt -> modelo -> tool -> Electron -> resultado -> chat / artifact
```

## Proyecto activo

El proyecto activo se comparte por eventos. El modo Inicio no tiene path de proyecto y debe seguir funcionando con datos globales.

| Evento | Uso |
| --- | --- |
| `codeclub:project-switch` | Cambiar proyecto desde la topbar o sidebar. |
| `codeclub:project-selection-changed` | Avisar qué proyecto ve un panel. |
| `codeclub:active-project` | Sincronizar el proyecto activo. |
| `codeclub:project-meta-changed` | Refrescar metadata y chats. |

## Navegación

| Evento | Resultado |
| --- | --- |
| `codeclub:open-chat` | Abrir un chat existente. |
| `codeclub:open-empty-chat` | Crear o mostrar un chat vacío. |
| `codeclub:open-extensions` | Mostrar Extensiones. |
| `codeclub:open-artifacts` | Abrir Artifacts en la sidebar derecha. |
| `codeclub:open-right-panel` | Abrir el navegador u otro panel derecho. |
| `codeclub:right-panel-back` | Volver a la pestaña anterior. |
| `codeclub:right-panel-forward` | Avanzar en pestañas visitadas. |

## Navegador y selección DOM

```text
BrowserPanel -> browser-state -> Computer Use
Computer Use -> browser-action -> BrowserPanel
selección DOM -> comentario -> referencia -> ChatInterface
```

Los comentarios se numeran en la página y la tarjeta se manda al chat como referencia, sin mezclarla con la burbuja textual del usuario.

## Tareas y artifacts

- `codeclub:scheduled-tasks-changed`: refresca tareas persistentes.
- `codeclub:artifacts-changed`: refresca planes y TODOs.
- `codeclub:artifact-reference`: agrega un artifact como referencia al chat.
- `codeclub:usage-updated`: actualiza métricas de uso.

## Idioma

`ChatInterface` emite `codeclub:language-change` con `{ language: 'es' | 'en' }`. Los componentes que usan `useAppLanguage()` se actualizan sin recargar la app y también cambia el atributo `lang` del documento.

## Update y recarga

La topbar consulta si existe una release más nueva. Si la hay, el icono de actualización se ilumina. El botón de recarga ejecuta una recarga completa de la ventana de Electron.

## Regla para nuevos eventos

Antes de agregar un evento, definir emisor, payload, consumidores y cleanup. Los listeners deben instalarse y removerse dentro del mismo `useEffect`.
