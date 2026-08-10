# Synapse

Synapse es el mapa vivo de la aplicación: conecta cada feature con su código, decisiones, tareas, validaciones y estado de entrega.

## Idea central

Una feature no debería existir como una tarea aislada. Debe representar una parte real del producto y reflejar cómo evoluciona en el código.

Ejemplo: `Login` puede vincular:

- Pantallas y componentes visuales.
- Archivos del frontend.
- Endpoints y contratos de API.
- Modelos y persistencia de datos.
- Tests y validaciones.
- Commits, ramas y entregables.

## Pipelines por perspectiva

Cada feature tiene una tarjeta principal y varias pipelines conectadas. No son tableros aislados: representan distintas perspectivas del mismo trabajo.

### Visual

`Wireframe → UI → Responsive → Aprobado`

Incluye screenshots, referencias visuales, componentes utilizados y pendientes de accesibilidad.

### Frontend

`Componentes → Estados → Integración → Validado`

Relaciona cada etapa con archivos, componentes, rutas y estados de interfaz.

### API

`Contrato → Endpoint → Errores → Conectado`

Muestra rutas, payloads, respuestas, permisos y consumidores del endpoint.

### Datos

`Modelo → Migración → Persistencia → Verificado`

Relaciona tablas, tipos, almacenamiento, migraciones y datos de prueba.

### QA

`Tests → Revisión → Validación visual → Listo`

Agrupa pruebas automatizadas, capturas antes/después, errores conocidos y criterios de aceptación.

### Release

`Changelog → Commit → Deploy → Monitoreo`

Conecta el entregable con Git, la versión publicada y las observaciones posteriores al lanzamiento.

## Información de cada tarjeta

Una tarjeta de Synapse debería mostrar, de forma resumida:

- Objetivo y problema que resuelve.
- Estado general y estado de cada pipeline.
- Archivos y líneas relacionadas.
- Dependencias entre componentes, APIs y datos.
- Últimos commits y cambios detectados.
- Tests ejecutados y errores pendientes.
- Screenshots o referencias del resultado.
- Decisiones tomadas por la persona o la IA.
- Tareas generadas y entregables completados.

## Actualización automática

El estado debería alimentarse de señales reales del proyecto:

- Cambios en archivos y estructura.
- Commits y ramas de Git.
- Tests y comandos ejecutados.
- Errores del navegador o runtime.
- Screenshots de validación.
- Planes y tareas creados por la IA.

La IA puede sugerir cambios de estado, pero las acciones importantes deben ser revisables antes de aplicarse.

## MVP recomendado

1. Crear una feature con descripción y criterio de éxito.
2. Generar automáticamente sus pipelines.
3. Vincular archivos y tareas a cada etapa.
4. Leer el estado básico desde Git.
5. Mostrar un resumen de avance y bloqueos.
6. Abrir directamente el archivo o panel relacionado.

## Principio de diseño

Synapse no debería ser otro Kanban. Su propuesta es mostrar qué parte de la aplicación se está construyendo, qué código la sostiene, qué falta para validarla y cómo llegó a producción.
