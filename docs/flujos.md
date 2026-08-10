# Flujos y eventos

## Mensaje del usuario

1. `ChatInterface` valida el input y crea el mensaje.
2. El engine selecciona modelo, tools y modo de ejecución.
3. AI SDK transmite texto y resultados estructurados.
4. Las tools invocan Electron cuando necesitan filesystem, terminal, navegador o procesos.
5. El resultado vuelve al chat y puede abrir un panel lateral.

## Eventos DOM

Los eventos internos usan el prefijo `codeclub:`. Los más importantes son:

- `codeclub:open-chat`, `codeclub:open-empty-chat`: navegación del chat.
- `codeclub:open-extensions`, `codeclub:close-extensions`: alternancia de Extensiones.
- `codeclub:project-selection-changed`, `codeclub:active-project`: proyecto activo.
- `codeclub:open-artifacts`, `codeclub:open-right-panel`: apertura desde tools.
- `codeclub:browser-navigate`, `codeclub:browser-state`, `codeclub:browser-action`: control del navegador.
- `codeclub:artifacts-changed`: refresco de planes y TODOs.
- `codeclub:right-panel-back`, `codeclub:right-panel-forward`: navegación de pestañas laterales.

Al agregar un evento nuevo, documentar emisor, payload y consumidores. Los listeners deben limpiarse en el retorno de `useEffect`.

## Selección de proyecto

La selección se comunica por eventos para que Topbar, WorkspaceManager, ChatInterface y los paneles laterales puedan reaccionar sin acoplamiento directo. Un proyecto vacío representa el modo global; no debe intentar leer un path inexistente.
