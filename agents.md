# Guía para agentes y colaboradores

Este archivo explica cómo trabajar en Codeclub sin romper su arquitectura ni su identidad visual.

## Qué es Codeclub

Codeclub es una app de escritorio Windows, local-first y orientada a desarrollo con IA. El renderer muestra la interfaz; Electron hace las operaciones nativas.

> Regla simple: React decide qué mostrar y Electron decide cómo tocar el sistema.

## Stack

| Parte | Tecnología |
| --- | --- |
| UI | Next.js 16.3, React 19, TypeScript |
| Estilos | Tailwind CSS 4 y tokens propios |
| Desktop | Electron 43, Node.js, TypeScript |
| IA | AI SDK v7 y proveedores OpenAI-compatible |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` |
| Editor | CodeMirror 6 |
| Datos | filesystem local, Electron storage y `localStorage` para settings livianos |

## Mapa del código

```text
src/app/page.tsx                 entrada de la app
src/app/layout.tsx               layout raíz y metadatos
src/app/globals.css              tokens, superficies y estados globales
src/components/Topbar.tsx        proyectos, actualización y controles de ventana
src/components/SubTopbar.tsx     navegación contextual y recarga
src/components/WorkspaceLayout.tsx layout, resize y paneles
src/components/WorkspaceManager.tsx navegación de vistas y chats
src/components/ChatPanel.tsx     wrapper del chat
src/components/ChatInterface.tsx input, streaming, mensajes y tools
src/components/ExtensionsPanel.tsx plugins, skills y MCP
src/lib/engine/                 ejecución, tools, planes y auditoría
src/lib/projectManager.ts       proyectos y chats por proyecto
src/lib/persistence.ts           settings locales
src/lib/runtime.ts               puente del renderer hacia IPC
electron/preload.cjs             API segura expuesta al renderer
electron/main.ts                 filesystem, terminales, WebView y procesos
```

## Flujo de una petición

```text
usuario
  -> ChatInterface
  -> AI SDK / agente
  -> tool elegida por el agente
  -> evento o IPC
  -> Electron / Windows
  -> resultado y auditoría
  -> chat, artifact o panel lateral
```

El renderer **no** usa Node.js directamente. Toda operación nativa pasa por `nativeInvoke` y el bridge de `preload.cjs`.

## Estado actual de la app

- Chats globales y chats separados por proyecto.
- Sidebar izquierda con Inicio, Tareas, Extensiones y Dispositivos desactivado visualmente.
- Sidebar derecha redimensionable con Archivos, Revisar, Navegador, Artifacts y Terminales.
- Tareas persistentes por proyecto, con frecuencia, modelo, proveedor, API key y ejecución manual.
- Browser WebView con selección DOM, comentarios numerados y referencias al chat.
- Terminales interactivas con PowerShell y PTY.
- Plugins, skills y MCP globales o filtrados por proyecto.
- Interfaz en español e inglés mediante `src/lib/i18n.ts`.
- Indicador de actualización y recarga completa de la app desde la topbar.
- Logo, icono de ventana y bandeja integrados desde `public/`.

## Convenciones de UI

- Mantener fondos `#111111`, `#161616`, `#191919`, `#1E1E1E`.
- Mantener bordes `#202020`, `#2B2B2B`, `#2C2C2C`.
- Mantener acentos `#8BC7FF`, `#3D9BFF`, `#1687FF`.
- Preferir controles pequeños, grises y minimalistas.
- Usar Motion solo para transiciones sutiles y resize.
- Las sidebars deben respetar el mínimo del panel central.
- Todo control solo-icono necesita `aria-label` y `title`.
- No agregar un dropdown nativo si ya existe un selector visual compartido.

## Idiomas

La fuente común está en `src/lib/i18n.ts`.

```ts
const language = useAppLanguage();
const text = translations[language];
```

Al cambiar el idioma se emite `codeclub:language-change`. No hardcodear textos nuevos en un solo idioma dentro de UI compartida.

## Eventos

Todos los eventos internos empiezan con `codeclub:`. Al crear uno nuevo, documentar:

1. quién lo emite;
2. qué contiene `detail`;
3. quién lo consume;
4. cómo se limpia el listener.

## Persistencia y seguridad

- No guardar API keys en mensajes, logs ni artifacts.
- Validar paths y evitar salir del proyecto activo.
- Mantener globales separados de datos por proyecto.
- Actualizar la UI después de mutaciones nativas mediante eventos.
- No usar comandos destructivos sin confirmar el objetivo exacto.

## Comandos

```bash
npm install
npm run dev
npm run next:dev
npm run next:build
npm run electron:compile
npm run electron:dev
npm run desktop:build
npm run package:win
```

## Releases

- `npm run package:win` genera localmente el instalador Windows en `release/`.
- No subir `release/` ni credenciales; ambos quedan fuera del repositorio.
- Las releases se disparan al pushear un tag `vX.Y.Z`.
- `.github/workflows/release.yml` construye en Windows y publica el `.exe`, `.blockmap`,
  `latest.yml` y `builder-debug.yml`.
- El usuario final descarga solo `Codeclub Setup X.Y.Z.exe`.
- El workflow usa `--publish never` en electron-builder y publica con GitHub Actions para
  evitar errores por falta de `GH_TOKEN`.
- Antes de crear un tag, probar `npm run package:win` e instalar el `.exe` localmente.
- Si se cambia la versión, actualizar `package.json` y `package-lock.json` juntos.

## Verificación antes de entregar

- [ ] `npm run next:build`
- [ ] `npm run electron:compile`
- [ ] `git diff --check`
- [ ] probar idioma ES/EN;
- [ ] probar cambio de proyecto y persistencia;
- [ ] probar sidebars, resize y panel central mínimo;
- [ ] probar tools, navegador, selección y terminal;
- [ ] revisar foco, labels y estados vacíos.

## Regla de Next.js

Antes de escribir código, consultar las guías instaladas en `node_modules/next/dist/docs/` cuando el cambio toque APIs o convenciones de Next.js.

<!-- BEGIN:nextjs-agent-rules -->

Esta versión puede diferir de versiones anteriores. Leer la guía correspondiente antes de aplicar patrones viejos.

<!-- END:nextjs-agent-rules -->
