# Persistencia y configuración

## Qué se guarda

| Alcance | Datos |
| --- | --- |
| Global | preferencias, idioma, chats de Inicio, plugins y settings globales. |
| Proyecto | chats, metadata, tareas, planes, TODOs, artifacts y configuración propia. |
| Sesión | PTY, terminales abiertas, WebView y estado vivo de selección. |

## Módulos

- `src/lib/persistence.ts`: settings y valores livianos del renderer.
- `src/lib/projectManager.ts`: índice de proyectos, metadata y chats.
- `src/lib/usage.ts`: tokens, costo, proveedor, modelo y duración.
- `src/lib/execution-log.ts`: historial de ejecuciones y tools.
- `src/lib/engine/planning.ts`: planes, TODOs y estados.
- `src/lib/agent-plugins.ts`: plugins, skills y MCP.
- `localStorage`: idioma, tamaños de sidebars, proyecto activo y preferencias de UI.

## Separación de chats

```text
Inicio       -> chats globales
Proyecto A   -> chats de A
Proyecto B   -> chats de B
```

Un chat de proyecto no debe aparecer en Inicio. Cada registro conserva el `projectPath` cuando corresponde.

## Reglas prácticas

- Usar rutas absolutas y validar que estén dentro del proyecto esperado.
- No guardar API keys en mensajes, logs ni artifacts visibles.
- Emitir un evento después de escribir datos para que la UI se actualice.
- Mantener estados vacíos útiles cuando no hay proyecto activo.
- Evitar que una tarea o un artifact de un proyecto se mezcle con otro.
- Limpiar procesos de sesión al desmontar terminales o paneles.

> La persistencia es local; borrar la carpeta de datos de Electron elimina la información guardada de la app.
