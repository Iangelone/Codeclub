# Codeclub

Documentación breve de la aplicación de escritorio local-first.

## Índice

- [Arquitectura](./arquitectura.md)
- [Flujos y eventos](./flujos.md)
- [Persistencia y configuración](./persistencia.md)
- [Terminal y navegador](./terminal-y-navegador.md)
- [Accesibilidad y Computer Use](./accesibilidad.md)
- [Desarrollo y verificación](./desarrollo.md)
- [Sidebar derecha](./sidebar-derecha.md)

## Resumen

Codeclub combina un renderer Next.js/React con un proceso nativo Electron. El renderer controla la interfaz y emite eventos `codeclub:*`; Electron ejecuta operaciones de sistema mediante IPC seguro.

La aplicación está organizada alrededor de tres espacios:

- chat y ejecución de agentes;
- navegación y gestión de proyectos;
- herramientas laterales: archivos, revisión, navegador, artifacts y terminales.

La app separa chats globales de chats asociados a proyectos y conserva settings, logs, uso y estado de planificación en el almacenamiento de Electron.
