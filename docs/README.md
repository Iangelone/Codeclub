# Documentación de Codeclub

> La guía corta para entender, usar y mantener la app.

## Índice

| Documento | Responde a |
| --- | --- |
| [Arquitectura](arquitectura.md) | ¿Cómo está armada la app? |
| [Flujos y eventos](flujos.md) | ¿Cómo se comunican sus partes? |
| [Persistencia](persistencia.md) | ¿Dónde se guardan chats, tareas y settings? |
| [Sidebar derecha](sidebar-derecha.md) | ¿Qué hacen sus paneles? |
| [Terminal y navegador](terminal-y-navegador.md) | ¿Cómo funcionan las herramientas interactivas? |
| [Accesibilidad](accesibilidad.md) | ¿Cómo hacer UI usable y observable? |
| [Desarrollo](desarrollo.md) | ¿Cómo correr, verificar y publicar? |
| [Synapse](synapse.md) | ¿Qué visión tienen Dispositivos y la trazabilidad? |

## Mapa mental

```text
Proyecto -> Chat -> Agente -> Tool -> Resultado
     |       |       |         |
     |       |       |         +-> archivos / terminal / navegador / artifacts
     |       |       +-> modelo y proveedor
     |       +-> historial persistente
     +-> settings, chats y tareas propias
```

## Principios

- **Local-first:** los datos de trabajo viven localmente.
- **Proyecto primero:** cada proyecto puede tener chats, tareas y artifacts propios.
- **Agente flexible:** el modelo elige tools del catálogo disponible.
- **Evidencia visible:** planes, TODOs, uso y logs ayudan a entender qué pasó.
- **UI simple:** pocos colores, controles chicos y estados claros.
