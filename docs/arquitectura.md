# Arquitectura

## La idea en una línea

```text
Next.js muestra -> React coordina -> Electron ejecuta -> Windows responde
```

## Capas

```text
Renderer: Next.js + React + Tailwind
  page -> Topbar + WorkspaceLayout
  WorkspaceLayout -> ChatPanel / ExtensionsPanel / paneles laterales
  ChatInterface -> AI SDK -> tools

Proceso nativo: Electron + Node.js
  preload.cjs -> bridge seguro
  main.ts -> IPC, filesystem, procesos, WebView y PTY
```

## Piezas principales

| Archivo | Responsabilidad |
| --- | --- |
| `src/app/page.tsx` | Entrada de la ventana y estado general. |
| `src/components/Topbar.tsx` | Proyectos, update, recarga y controles de ventana. |
| `src/components/SubTopbar.tsx` | Navegación contextual, breadcrumbs y búsqueda. |
| `src/components/WorkspaceLayout.tsx` | Tres columnas, resize y paneles internos. |
| `src/components/WorkspaceManager.tsx` | Navegación entre chat, tareas y extensiones. |
| `src/components/ChatInterface.tsx` | Input, mensajes, streaming, referencias y tools. |
| `src/components/ExtensionsPanel.tsx` | Plugins, skills y servidores MCP. |
| `src/lib/engine/` | Ejecución, tools, planes, TODOs y auditoría. |
| `src/lib/projectManager.ts` | Proyectos, metadata y chats. |
| `src/lib/i18n.ts` | Catálogo español/inglés y cambio de idioma. |
| `electron/preload.cjs` | API permitida para el renderer. |
| `electron/main.ts` | Operaciones nativas y ciclo de Electron. |

## Layout

```text
Topbar
┌──────────────┬──────────────────────────┬──────────────┐
│ izquierda    │ panel central            │ derecha      │
│ navegación   │ chat / tareas / plugins  │ tools        │
└──────────────┴──────────────────────────┴──────────────┘
```

Las sidebars se redimensionan, pero el panel central conserva un mínimo. La sidebar derecha usa pestañas; Browser y Terminales pueden tener más de una instancia.

## Seguridad del renderer

- React no importa `fs`, `child_process` ni APIs nativas.
- Las operaciones pasan por `nativeInvoke`.
- `preload.cjs` expone una superficie limitada.
- El proceso principal valida argumentos antes de tocar el sistema.

## Extensibilidad

El agente puede descubrir tools, skills y MCP sin llenar cada system prompt con una lista fija. Las descripciones de las tools explican cuándo usarlas y el modelo decide el flujo.
