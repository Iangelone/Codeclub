# Revisión de arquitectura y buenas prácticas

Fecha: 13 de octubre de 2026. Revisión estática de módulos y configuración; no es una auditoría completa de seguridad ni una prueba de explotación. No se modificó código funcional. Los builds de Next.js y Electron pasaron durante la actualización anterior de agents.md; eso no demuestra ausencia de errores de tipos en el renderer ni valida todos los flujos.

Seguimiento autorizado: se habilitó la validación de tipos en el build, se agregaron typecheck/verify y controles de CI/release, y se separaron presentación, editor, transporte/helpers del chat, archivos nativos, plugins y overlay. La tabla de abajo describe el estado previo a esos cambios. Los permisos nativos y la autonomía quedaron fuera del alcance solicitado. [Arquitectura actual](architecture.md) y [verificación](development.md) describen los módulos y comandos nuevos. ChatInterface y main siguen siendo coordinadores grandes; esta separación reduce responsabilidades, no elimina todo el trabajo futuro de mantenimiento.

## Qué arquitectura estamos usando

Codeclub es una aplicación de escritorio local-first con arquitectura por capas y separación de procesos:

1. **Presentación y coordinación:** Next.js exportado estáticamente, React y componentes de interfaz. Next.js no funciona como backend de las operaciones nativas.
2. **Aplicación:** selección de proveedor, contexto, ejecución del agente, herramientas, planificación y coordinación de sesiones.
3. **Puente:** API del preload e IPC entre renderer y Electron.
4. **Infraestructura:** filesystem, SQLite, credenciales, PTY, browser, Windows y Android.

También usa eventos para sincronizar superficies y ventanas. Dentro del agente hay un grafo de ejecución LangGraph y adaptadores de transporte/herramientas mediante AI SDK y LangChain.

Es una arquitectura pragmática por capas, con rasgos de puertos/adaptadores. No la llamaría Clean Architecture o arquitectura hexagonal estricta: componentes como ChatInterface contienen decisiones de aplicación y conocen proveedores, persistencia y herramientas. Es un único producto modular repartido en procesos, no microservicios. Los componentes de React no convierten automáticamente esto en MVC.

## Qué está bien

- Separación renderer/native: las ventanas principales usan contextIsolation y desactivan nodeIntegration. El sistema se opera mediante el bridge, no importando fs desde React.
- Historial con SQLite, WAL, transacciones y claves por scope/chat; escrituras con controles de concurrencia. Ver electron/chat-store.ts.
- Credenciales separadas del historial, cifradas con safeStorage/DPAPI y asociadas a un origen. Ver electron/credential-vault.ts.
- Routing centralizado en src/lib/ai-routing.ts. El catálogo diferencia metadatos de models.dev, Gateway y Gemini nativo; las fuentes fallan de forma independiente.
- Motor compartido con validación de herramientas, cancelación, presupuestos y contabilización. Ver src/lib/engine/run.ts.
- Pruebas de regresión específicas para chats, navegador, herramientas nativas, tareas, orbes, MCP y Android. Hay más trabajo de verificación que en un prototipo habitual.
- Guías de accesibilidad, idiomas, eventos y persistencia. Son buenas restricciones para mantener coherencia al crecer.

## Qué priorizaría como senior

| Prioridad | Evidencia | Riesgo y siguiente paso |
| --- | --- | --- |
| Alta | electron/main.ts:1140–1160 expone files:read, files:write-text y files:remove sin validar sender o alcance del path en esos handlers. electron/preload.cjs:23–25 permite escribir/eliminar desde el bridge. | Un renderer con acceso al bridge puede operar rutas arbitrarias; remove es recursivo. Unificar autorización y validación nativa. Distinguir explícitamente archivos del proyecto, configuración interna y archivos elegidos por el usuario. Probar acceso fuera del scope y renderer no autorizado. No se comprobó un vector remoto de explotación. |
| Alta | next.config.mjs:2 tiene typescript.ignoreBuildErrors=true. .github/workflows/release.yml instala y empaqueta, pero no ejecuta un typecheck global ni regresiones. | Puede publicarse un renderer con errores TypeScript. Agregar un typecheck obligatorio y CI para PR/push con una selección estable de pruebas. Después, evaluar quitar la omisión del build. |
| Media | ChatInterface.tsx tiene 3910 líneas y electron/main.ts 1357 en esta revisión. Chat configura transporte, coordina ejecución, historial y UI. | Cambios pequeños exigen comprender demasiado y favorecen acoplamiento. Extraer por comportamiento: configuración del modelo, ciclo del chat, repositorio de historial y registro de handlers. Hacerlo gradualmente con pruebas existentes, no mediante una reescritura. |
| Media | El engine, projectManager y handlers contienen numerosos any; el preload está en CommonJS JavaScript. | strict=true no protege lo que atraviesa any ni valida IPC en runtime. Definir contratos compartidos request/result y validar entradas en Electron; usar unknown para datos externos. Empezar por archivos, credenciales y ejecución. |
| Media | loadProjects captura cualquier error como lista vacía y saveProjects escribe directamente el JSON (main.ts:321–322). SettingsStore y CredentialVault usan temporales, pero parsean JSON sin recuperación explícita. | Datos corruptos pueden parecer una instalación vacía o impedir arranque. Diferenciar archivo ausente de corrupción, conservar evidencia, ofrecer recuperación y probar interrupciones. Añadir versión/migraciones y política de respaldo a los stores que lo necesiten. |

La prioridad de IPC es proteger la capacidad real de la aplicación: las aprobaciones dentro de las herramientas del agente no sustituyen controles en todos los canales nativos. Tampoco basta con contextIsolation si el propio bridge concede una operación demasiado amplia.

## Cosas que suelen olvidarse

Estos son puntos para comprobar o diseñar; no todos son fallos demostrados:

- **Modelo de amenazas:** renderer confiable, páginas externas, plugins/MCP, tareas, teléfono y ventanas auxiliares tienen capacidades diferentes. Documentar quién puede hacer qué y aplicar esa política en Electron, incluyendo frame/origen cuando corresponda.
- **Interrupción y repetición:** el grafo no tiene checkpoints. Definir qué ve el usuario tras reiniciar, qué queda pendiente y qué acciones no pueden repetirse. Un timeout no significa que una mutación no ocurrió.
- **Datos y soporte:** backups, exportación, restauración y migraciones verificables. No copiar una base SQLite viva ignorando WAL ni registrar secretos en diagnósticos.
- **Release:** comprobar firma del instalador, recuperación de actualización fallida y minimización de permisos de CI. El workflow revisado referencia acciones por tags y publica release/*; revisar qué archivos deben salir realmente y considerar fijar acciones por commit.
- **Rendimiento:** medir antes de mover trabajo. SQLite y algunos stores son síncronos en main; búsquedas o migraciones grandes pueden bloquearlo. Definir presupuestos de latencia y crecimiento de logs/historial.
- **Calidad del agente:** una prueba del protocolo no prueba calidad de programación. Mantener tareas reproducibles con criterios de éxito, efectos reales verificados y medición de costos; separar evaluación del modelo de regresión del producto.
- **Errores y diagnóstico:** evitar capturas silenciosas cuando importan datos o ejecución. Mantener IDs de run y errores útiles, con redacción de secretos y contenido sensible.

## Orden práctico

Primero cerraría permisos/rutas IPC y pondría typecheck y regresiones en CI. Después extraería responsabilidades de ChatInterface y main al tocar cada área. Luego reforzaría recuperación de datos y releases. No agregaría más frameworks: el problema principal es asegurar y hacer verificables los límites que ya existen.

El proyecto tiene decisiones sólidas y pruebas valiosas. Lo pendiente es convertir las convenciones documentadas en garantías automáticas y consistentes; agregar funciones sin eso aumenta el costo de mantenimiento.
