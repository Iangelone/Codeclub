# Codeclub

## Stack actual

Codeclub es una app de escritorio local-first:

- Next.js 16.3 + React 19: interfaz.
- Tailwind CSS: estilos y tokens visuales.
- Electron + Node.js: ventana, archivos, terminal, HTTP, navegador, MCP y plugins.
- AI SDK v7: streaming, modelos y tools.
- npm: instalación, desarrollo y builds.

## Arquitectura

- src/app/page.tsx: entrada del App Router.
- src/components/Topbar.tsx: barra superior y controles de ventana.
- src/components/WorkspaceLayout.tsx: gestor de paneles redimensionables.
- src/components/WorkspaceManager.tsx: navegación de vistas.
- src/components/ChatPanel.tsx: wrapper del chat.
- src/components/ChatInterface.tsx: mensajes, input, streaming y tools.
- electron/main.ts: proceso nativo e IPC.
- electron/preload.cjs: puente seguro entre React y Electron.
- src/lib/engine: ejecución de IA, tools, planes y auditoría.

## Flujo

Mensaje del usuario -> ChatInterface -> AI SDK -> tools -> IPC de Electron -> Node.js -> Windows.

Los componentes se comunican mediante eventos DOM con el prefijo codeclub:. El renderer nunca accede directamente a Node.js.

## Persistencia

La app guarda settings, proyectos, chats, uso y logs en las carpetas de configuración/cache de Electron. Los chats se separan por proyecto.

## Tokens

- Fondos: #111111, #161616, #191919, #1E1E1E.
- Bordes: #202020, #2B2B2B, #2C2C2C.
- Acentos: #8BC7FF, #3D9BFF, #1687FF.

## Comandos

- npm run dev: inicia Next.js y Electron para desarrollo.
- npm run next:dev: inicia solo el renderer.
- npm run desktop:build: genera el build y compila Electron.
- npm run electron:dev: compila y abre Electron.
- npm install: instala dependencias.

## Regla Next.js

Esta versión puede tener cambios respecto de versiones anteriores. Antes de escribir código, consultar las guías relevantes en node_modules/next/dist/docs/.

