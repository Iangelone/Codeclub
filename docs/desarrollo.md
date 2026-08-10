# Desarrollo y verificación

## Requisitos

- Node.js compatible con Next.js 16.
- npm.
- Electron y dependencias instaladas con `npm install`.

## Comandos

- `npm run dev`: desarrollo completo Next.js + Electron.
- `npm run next:dev`: solo renderer.
- `npm run electron:dev`: compila Electron y abre la app.
- `npm run next:build`: build del renderer.
- `npm run electron:compile`: compila `electron/main.ts`.
- `npm run desktop:build`: build del renderer y compilación Electron.

## Verificación mínima

Después de cambios de UI:

1. `npm run next:build`.
2. Probar navegación de sidebar, tabs y estados vacíos.
3. Verificar foco con teclado y nombres accesibles.

Después de cambios de Electron, PTY o IPC:

1. `npm run electron:compile`.
2. Abrir la app con `npm run electron:dev`.
3. Probar una operación real y su cleanup al desmontar.

## Regla de cambios

Preferir componentes pequeños, eventos explícitos y cambios reversibles. No introducir dependencias nuevas si una API existente resuelve el problema. Cuando una dependencia nativa cambia, verificar su compatibilidad con la versión de Electron.
