# Synapse y Dispositivos

## Qué es Synapse

Synapse es la visión para conectar una feature con su código, tareas, validaciones y release. No es otro Kanban: muestra qué se está construyendo y qué evidencia lo sostiene.

## Dispositivos

La sección **Dispositivos** reemplazó visualmente a Synapse en la sidebar izquierda y hoy está desactivada. La idea futura es conectar un celular Android al IDE mediante un QR.

```text
Codeclub en PC -> QR -> app Android -> canal seguro -> IDE
```

Todavía no hay runtime móvil ni conexión activa. Por eso el acceso se conserva en la interfaz, pero no se puede abrir como función usable.

## Modelo de una feature

| Pipeline | Flujo |
| --- | --- |
| Visual | Wireframe → UI → Responsive → Aprobado |
| Frontend | Componentes → Estados → Integración → Validado |
| API | Contrato → Endpoint → Errores → Conectado |
| Datos | Modelo → Persistencia → Verificado |
| QA | Tests → Revisión → Validación visual → Listo |
| Release | Changelog → Commit → Deploy → Monitoreo |

## Qué debería mostrar

- objetivo y criterio de éxito;
- estado general y bloqueos;
- archivos y componentes relacionados;
- planes y TODOs;
- commits y cambios de Git;
- validaciones ejecutadas;
- screenshots y referencias;
- decisiones tomadas por la persona o la IA.

## MVP futuro

1. Crear una feature.
2. Generar pipelines.
3. Vincular archivos y tareas.
4. Leer estado básico de Git.
5. Mostrar avance y bloqueos.
6. Abrir el archivo o panel relacionado.
