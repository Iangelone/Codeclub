# Arquitectura

## Capas

```text
Next.js/React
  page -> Topbar + WorkspaceLayout
  WorkspaceLayout -> ChatPanel / ExtensionsPanel / panels laterales
  ChatInterface -> AI SDK -> tools y eventos

Electron
  preload.cjs -> nativeInvoke seguro
  main.ts -> IPC, filesystem, procesos, webview y PTY
```

## Entrada de la aplicación

- `src/app/page.tsx`: monta la ventana lógica y controla la apertura de sidebars.
- `src/app/layout.tsx`: layout raíz y metadatos.
- `src/app/globals.css`: tokens, superficies, estados de foco y reglas compartidas.

## Shell visual

- `Topbar.tsx`: proyectos, controles de ventana y apertura de sidebars.
- `WorkspaceLayout.tsx`: layout principal, sidebar izquierda, panel central, sidebar derecha, resize y paneles internos.
- `SubTopbar.tsx`: navegación contextual y breadcrumbs del workspace.
- `WorkspaceManager.tsx`: alterna chat y Extensiones, conserva navegación del panel izquierdo y selección de proyecto.

## Chat y agentes

- `ChatPanel.tsx`: adapta el catálogo de proveedores/modelos al workspace.
- `ChatInterface.tsx`: mensajes, input, streaming, comandos, tools, preview de archivos y apertura de paneles.
- `src/lib/engine/run.ts`: ejecución del agente y ciclo de streaming.
- `src/lib/engine/tools.ts`: catálogo de tools, acceso dinámico, artifacts, navegador, terminales y subagentes.
- `src/lib/engine/planning.ts`: planes, TODOs y estados de ejecución.

## Paneles laterales

La sidebar derecha se administra en `WorkspaceLayout.tsx` mediante instancias identificadas por `instanceId`. Las pestañas disponibles son Archivos, Revisar, Navegador, Artifacts y Terminales. Browser y Terminales pueden abrir múltiples instancias; las demás se reutilizan.

La sidebar izquierda activa `new-chat`, `scheduled`, `extensions` o `projects`. Extensiones vive dentro de `WorkspaceManager`; Synapse y Programadas usan paneles introductorios propios dentro de `PanelManager`.

## Proceso nativo

- `electron/preload.cjs`: expone únicamente el puente IPC necesario.
- `electron/main.ts`: filesystem, proyectos, comandos, logs, terminales, PTY, integración de navegador y acciones nativas.
- `src/lib/runtime.ts`: wrapper del renderer para invocar operaciones nativas.

El renderer no accede directamente a Node.js.
