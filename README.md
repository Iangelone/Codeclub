# Codeclub

> Un IDE de escritorio local-first para construir software con agentes de IA.

Codeclub combina chat, proyectos, terminal, navegador, herramientas de desarrollo y evidencia del trabajo en una sola app para Windows.

[![Estado](https://img.shields.io/badge/estado-beta-3d9bff)](#estado) [![Plataforma](https://img.shields.io/badge/plataforma-Windows-1687ff)](#requisitos)

## En criollo

Abrís un proyecto, hablás con el agente y le pedís que trabaje sobre tu código. El agente puede leer archivos, buscar texto, editar, usar la terminal, navegar una página y dejar planes o TODOs visibles.

La app corre localmente y guarda chats, proyectos, configuraciones, uso y logs en el almacenamiento de Electron. Tus datos no dependen de un servidor de Codeclub.

## Qué trae hoy

### Chat y agente

- Streaming de respuestas con AI SDK v7.
- Proveedores y modelos compatibles con OpenAI.
- Catálogo dinámico de modelos y proveedores.
- Selección libre de tools según la intención del prompt.
- Planes, TODOs, estado de tareas y artifacts.
- Historial global y chats separados por proyecto.
- Adjuntos de texto, imágenes, PDF y DOCX.
- Referencias visuales desde el navegador embebido.
- Confirmación humana para operaciones sensibles.

### Espacio de trabajo

| Zona | Para qué sirve |
| --- | --- |
| Sidebar izquierda | Inicio, chats recientes, proyectos, Tareas, Extensiones y Dispositivos desactivado visualmente. |
| Panel central | Chat, Extensiones, Tareas y la vista de Dispositivos preparada para QR. |
| Sidebar derecha | Archivos, Revisar, Navegador, Artifacts y Terminales. |
| Topbar | Proyectos, navegación, paneles, actualización y controles de ventana. |

Las dos sidebars se pueden redimensionar. El panel central conserva un ancho mínimo para no quedar aplastado.

### Herramientas laterales

- **Archivos:** árbol del proyecto, búsqueda, apertura y previews.
- **Revisar:** cambios del workspace y estado de Git.
- **Navegador:** WebView de Electron con URL, navegación, recarga y apertura externa.
- **Selección DOM:** seleccioná un elemento, agregá un comentario y mandalo como referencia al chat.
- **Artifacts:** planes y TODOs generados por el agente, filtrables y persistentes por proyecto.
- **Terminales:** terminales interactivas con xterm y PTY de PowerShell.

### Tareas programadas

Las tareas se guardan en la app y cada proyecto puede tener las suyas. Una tarea permite elegir:

- proveedor, modelo y API key;
- prompt;
- frecuencia: diaria, días hábiles, semanal o personalizada;
- intervalo, horario y notificaciones;
- estado activada o pausada;
- ejecución manual con el botón de play;
- guardado explícito con el check.

Por defecto, cada ejecución se plantea para un chat nuevo en segundo plano.

### Extensiones e idioma

El panel **Extensiones** muestra elementos globales y los filtrados por el proyecto activo: plugins, skills (`SKILL.md`) y servidores MCP.

La interfaz soporta español e inglés. El idioma se guarda localmente y se aplica a navegación, sidebars, tareas, navegador, artifacts, extensiones y estados principales.

## Tools principales del agente

| Grupo | Tools actuales |
| --- | --- |
| Archivos | `listFiles`, `readFile`, `searchText`, `writeFile` |
| Terminal | `runCommand`, `terminal` |
| Navegador | `openBrowser`, `getBrowserState`, `browserAction` |
| PC | `computerListWindows`, `computerGetState`, `computerScreenshot`, `computerOcr`, `computerAction` |
| Planificación | `createPlan`, `updatePlan`, `todo`, `getTaskStatus` |
| Auditoría | `getExecutionLog` |
| Plugins / MCP | `createSkill`, `createExtension`, `deleteExtension`, `createMcpServer`, `deleteMcpServer` |
| Proyecto | `switchProject` |
| Colaboración | `subagent`, `swarm`, `askUser` |
| Descubrimiento | `searchTools`, `executeTool`, `listAvailableTools` |

> Las tools no están hardcodeadas en cada prompt: el agente recibe el catálogo disponible y decide cuáles necesita.

## Arquitectura rápida

```text
React / Next.js
  page.tsx
    Topbar
    WorkspaceLayout
      ChatPanel -> ChatInterface -> AI SDK -> tools
      ExtensionsPanel
      Sidebar derecha

Electron
  preload.cjs -> puente IPC seguro
  main.ts    -> filesystem, terminal, WebView, HTTP, Git y procesos nativos
```

El renderer nunca accede directamente a Node.js. La comunicación interna usa eventos DOM `codeclub:*` e IPC a través de `src/lib/runtime.ts`.

## Requisitos

- Windows.
- Node.js 24 o compatible con Next.js 16.
- npm 11 recomendado.
- Una API key de un proveedor compatible para usar el agente.

## Instalar y ejecutar

```bash
npm install
npm run dev
```

Solo renderer:

```bash
npm run next:dev
```

## Build y verificación

```bash
npm run next:build
npm run electron:compile
npm run desktop:build
npm run package:win
```

`package:win` genera el instalador Windows en `release/`. Para el flujo completo de beta,
incluyendo tags y GitHub Actions, consultar [Desarrollo y releases](docs/desarrollo.md).

Antes de publicar, probar chat, cambio de proyecto, persistencia, tareas, selección del navegador, artifacts, terminal y cambio de idioma.

## Documentación

- [Índice de documentación](docs/README.md)
- [Arquitectura](docs/arquitectura.md)
- [Flujos y eventos](docs/flujos.md)
- [Persistencia](docs/persistencia.md)
- [Sidebar derecha](docs/sidebar-derecha.md)
- [Terminal y navegador](docs/terminal-y-navegador.md)
- [Accesibilidad y Computer Use](docs/accesibilidad.md)
- [Desarrollo y releases](docs/desarrollo.md)
- [Synapse y Dispositivos](docs/synapse.md)

## Estado

Codeclub está en beta temprana. La app es usable para desarrollo local, pero la conexión móvil por QR, la ejecución automática real de tareas y la distribución estable siguen en evolución.

## Comunidad y soporte

- Donaciones: [Ko-fi](https://ko-fi.com/iangeldev)
- Issues y mejoras: GitHub del proyecto
- Licencias comerciales: `codeclubide@gmail.com`

## Licencia

Codeclub usa una **licencia dual**: gratuita para uso personal, educativo, open source y organizaciones sin fines de lucro; comercial paga para empresas y uso con fines de lucro.

Leé los términos completos en [LICENSE.md](LICENSE.md).
