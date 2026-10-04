# Tareas programadas

Electron mantiene un reloj de 15 segundos y una cola persistente en `userData/scheduled-tasks.json`. Cada tarea pertenece a un proyecto canónico o al alcance global. El proceso admite una sola instancia de la app para evitar dos relojes sobre el mismo archivo.

Los horarios diarios, hábiles y semanales usan una zona IANA. Los horarios inexistentes durante el cambio de hora se omiten; una hora repetida no dispara dos ejecuciones en la misma fecha local. La frecuencia personalizada mide tiempo transcurrido desde la creación o cambio de horario. `Una vez` almacena un instante ISO y se pausa después de dispararlo. Después de suspender Windows o reiniciar Codeclub, cada tarea vencida se ejecuta una vez; no se reproducen todas las ejecuciones omitidas. Una ejecución activa no se duplica ni se reintenta automáticamente.

Las tareas se ejecutan mientras Codeclub está abierto, también al minimizarlo a la bandeja. No despiertan Windows ni funcionan después de salir completamente de la app. Las ejecuciones se serializan y tienen un límite de 30 minutos y 32 pasos del agente. Al cancelar se abortan también el transporte HTTP y los comandos nativos de la tarea; sus terminales se detienen. Una ejecución interrumpida por un cierre abrupto queda registrada como interrumpida al iniciar; no se repiten automáticamente sus posibles cambios.

Cada ejecución abre un renderer invisible e independiente con su propio navegador, con el preload existente. La asignación se obtiene por IPC y está vinculada al WebContents propietario. Este renderer usa AI SDK, el proveedor/modelo guardados, los headers configurados, el razonamiento seleccionado, las instrucciones AGENTS.md del proyecto y los plugins/MCP disponibles. Las credenciales permanecen en CredentialVault y Electron las incorpora al transporte HTTP. No se almacenan en la configuración de tareas.

Cada resultado se guarda en un chat independiente del alcance de la tarea. Actividad permite aprobar y cancelar; las operaciones con efectos requieren aprobación antes de ejecutarse. La aprobación expira a los dos minutos y la tarea falla con un estado explícito si no se concede. Una tarea que pide información adicional tampoco se marca completada. Las tareas no pueden cambiar de proyecto, iniciar subagentes ni administrar otras tareas de forma recursiva. El historial conserva las últimas 20 ejecuciones; los chats conservan los resultados completos. Las notificaciones respetan todas las ejecuciones, solo errores o ninguna.

Las herramientas del chat `scheduleTask`, `listScheduledTasks` y `manageScheduledTask` crean y administran tareas del alcance actual. Las tareas nuevas usan el proveedor/modelo del chat. La interfaz permite editarlos. Los datos anteriores se importan desde cada proyecto registrado y el alcance global; las claves anteriores se trasladan al vault y los borradores incompletos se conservan sin claves en texto plano.

## Eventos

| Evento | Emisor | Payload | Consumidores y limpieza |
| --- | --- | --- | --- |
| `codeclub:scheduled-tasks-changed` (IPC) | TaskScheduler en Electron después de cada guardado o transición | Sin payload | `ScheduledPanel` vuelve a consultar el alcance; HomePage invalida cachés y refresca chats y workspace. `onTasksChanged` devuelve el dispose; ambos efectos lo ejecutan al desmontar. |
| `codeclub:global-chat-changed`, `codeclub:project-meta-changed`, `codeclub:workspace-changed` (DOM existentes) | HomePage al recibir el cambio nativo | Sin payload: solicita refresco de la vista actual | Listeners existentes de navegación y paneles, limpiados en sus respectivos useEffect. |
| `codeclub:session-command` (IPC existente) | SessionHub, a pedido de Actividad o Tareas | owner, runId, chat, action y approvalId opcional | ScheduledTaskRunner valida runId/chat; su finally elimina el listener y todos los timers de aprobación. |

## Verificación

`npm run electron:compile`, `node scripts/test-task-scheduler.mjs`, `node scripts/test-scheduled-tasks.mjs`, `npx tsc --noEmit`, `npm run next:build` y `git diff --check`.

Las pruebas del runner usan el motor AI SDK real con un endpoint local simulado. Verifican enrutamiento, tools, aprobación/rechazo, cancelación, falta de credenciales, error HTTP y eventos de navegador con un WebView simulado; las pruebas de interfaz verifican creación, ejecución, pausa, eliminación, idioma y cambio de proyecto. No requieren credenciales reales ni consumen tokens externos.

Para verificar contra Gateway real, ejecutá `node scripts/test-scheduled-tasks-live.mjs` en una terminal después de compilar Electron. La clave se recibe por stdin sin eco o mediante `AI_GATEWAY_API_KEY`; nunca se escribe en código o reportes. La prueba consulta el catálogo actual y elige exclusivamente un modelo de lenguaje con tools y precios de entrada/salida iguales a cero. No contiene identificadores fijos de modelo ni proveedor: resuelve el transporte desde el catálogo de la aplicación. Si no hay candidatos gratuitos, falla sin usar modelos pagos.

Esta prueba inicia el proceso Electron real con un perfil temporal aislado y ventanas invisibles. Guarda la credencial usando el preload y CredentialVault, crea una tarea de una sola ejecución y espera al reloj automático, sin invocar ejecución manual. El modelo debe leer un archivo que contiene un valor aleatorio y devolverlo; se comprueban la tool, el chat guardado, el consumo y una sola ejecución. El proceso y los archivos del perfil de prueba se eliminan al terminar, incluyendo la copia cifrada de la credencial.
