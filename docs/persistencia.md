# Persistencia y configuración

## Módulos

- `src/lib/persistence.ts`: settings y registros persistentes del renderer.
- `src/lib/projectManager.ts`: índice de proyectos, metadatos y chats por proyecto.
- `src/lib/execution-log.ts`: auditoría de ejecuciones y eventos de tools.
- `src/lib/usage.ts`: consumo y métricas de generaciones.
- `src/lib/store.ts`: estado liviano compartido del chat activo.
- `src/lib/agent-plugins.ts`: descubrimiento de plugins, skills y servidores MCP.

## Alcance de datos

- Global: preferencias, chats sin proyecto, plugins y configuraciones globales.
- Proyecto: chats, metadata, planes, TODOs, logs y configuraciones del proyecto.
- Sesión: terminales PTY y estado vivo del navegador.

## Reglas

- Resolver paths con rutas absolutas y validar que queden dentro del proyecto.
- No persistir credenciales en mensajes, logs ni estado visible.
- Actualizar la UI mediante eventos después de mutaciones nativas.
- Mantener el modo sin proyecto funcional para datos globales y estados vacíos.
