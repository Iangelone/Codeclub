# Motor del agente: integración y límites

Revisión: 4 de octubre de 2026. Basada en el código actual, las dependencias instaladas y las fuentes oficiales enlazadas. Este documento distingue implementación, pruebas y mejoras pendientes; no certifica compatibilidad completa con un framework o estándar.

## Consulta rápida

**Codeclub usa LangGraph para coordinar la ejecución, LangChain para validar y ejecutar tools y AI SDK v7 para transporte y streaming. Mantiene un cliente propio para Agent Plugins/MCP. No usa Deep Agents ni tiene LangSmith configurado.** Tener herramientas disponibles no garantiza que el modelo elija bien, complete un trabajo largo o verifique correctamente el resultado.

| Tecnología | Estado real | Dónde consultar |
| --- | --- | --- |
| AI SDK | Integrado: `ToolLoopAgent` con un paso por nodo, streaming, tools, cancelación y uso de tokens. Instalado `ai@7.0.16`. | [Motor](../src/lib/engine/run.ts), [documentación oficial](https://ai-sdk.dev/docs/introduction) |
| Gateway y proveedores compatibles | Catálogo y credenciales dinámicos; el usuario selecciona proveedor/modelo. | [Catálogo y routing](ai-catalog.md), [rutas](../src/lib/ai-routing.ts) |
| Agent Plugins | Carga paquetes locales, skills y servidores MCP; cumplimiento del estándar parcial. | [Puente de plugins](../src/lib/agent-plugins.ts), [checklist oficial](https://agent-plugins.org/client-implementers/conformance) |
| LangChain / LangGraph | Integrados en el motor compartido: `langchain@1.5.15`, `@langchain/core@1.2.14`, `@langchain/langgraph@1.4.19`. | [Implementación](../src/lib/engine/run.ts), [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview) |
| Deep Agents | No está integrado. Es una referencia para contexto y autonomía. | [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) |
| LangSmith / AI SDK DevTools | LangSmith no está integrado. DevTools está instalado, pero no hay registro activo; telemetría SDK deshabilitada en el motor. | [Uso local](../src/lib/usage.ts), [auditoría](../src/lib/execution-log.ts) |

La integración cambia el control de la ejecución y la validación de tools; su calidad debe medirse con tareas reproducibles. Instalar librerías por sí solo no mejora las respuestas.

## Flujo que se ejecuta hoy

```text
ChatInterface / ScheduledTaskRunner
  -> catálogo + selección + almacén de credenciales
  -> tools nativas + plugins/MCP + descubrimiento de skills
  -> runStream -> LangGraph prepare -> model -> finish
                   ^                  |
                   +-- si hay tools --+
  -> model: ToolLoopAgent de un paso -> modelo seleccionado
  -> tool: LangChain invoke -> preload/IPC -> Electron o MCP
  -> respuesta, historial, tokens y evidencia de ejecución
```

React configura y presenta la ejecución; Electron realiza operaciones del sistema. Los MCP remotos se conectan mediante `@ai-sdk/mcp`; stdio se ejecuta en Electron. Un servidor externo tiene su propio entorno y permisos: no debe asumirse que está limitado automáticamente al proyecto.

## LangGraph y LangChain: integración activa

El motor compartido de chat, tareas y llamadas auxiliares compila un `StateGraph` por ejecución. El estado incluye mensajes, contador de pasos y la decisión de continuar. El nodo `prepare` comprueba/compacta contexto; `model` realiza un paso del SDK y conserva mensajes y resultados de tools; `finish` publica el cierre y el uso agregado. Las aristas condicionales repiten `prepare` únicamente cuando las llamadas a tools tienen resultados y queda presupuesto de pasos.

El grafo no almacena el proveedor, las credenciales ni los objetos de tools en su estado: permanecen en el entorno de la llamada. Modelo, proveedor, opciones de razonamiento y endpoint siguen resolviéndose por la selección existente; no se introduce un modelo fijo.

`adaptLangChainTools` conserva metadatos del SDK y adapta cada executor local a `langchain.tool`. Convierte el esquema mediante `asSchema` y llama a `invoke`, que valida el input antes de ejecutar efectos. Se conservan los argumentos y opciones originales del executor, incluidos IDs y cancelación. Las tools sin executor local se mantienen sin envolver. El control de aprobaciones sigue en las tools existentes y Electron sigue siendo el puente nativo.

No se configura un checkpointer: el estado del grafo vive durante la ejecución. Historial y scheduler conservan su persistencia, pero un cierre de la app no permite reanudar un nodo a mitad de trabajo. Tampoco se habilitan servicios LangSmith, delegación ni memoria semántica con esta integración.

## AI SDK: qué aprovechamos

En [run.ts](../src/lib/engine/run.ts), AI SDK controla un paso de modelo/herramientas dentro de cada nodo del grafo. `instructions` establece el sistema y `fullStream` entrega texto, razonamiento y eventos. Se usan callbacks de pasos, herramientas y consumo, además de `AbortSignal`, `smoothStream` y salida estructurada cuando corresponde. El motor conserva numeración global de pasos y publica consumo/cierre una vez por ejecución.

El nodo `prepare` comprueba el presupuesto de contexto y `pruneMessages` elimina razonamiento y resultados antiguos. La estimación usa bytes UTF-8, no un tokenizer exacto. El chat solicita hasta 128 pasos, las tareas programadas 32 y las llamadas auxiliares usan 8 por defecto. El modelo puede terminar antes; llegar al límite no demuestra que el objetivo esté terminado. Los errores de herramientas también vuelven al modelo para que corrija argumentos sin reproducir efectos previos. [Historiales](revision-chat-historiales.md) explica la ventana reciente, SQLite, los extractos y la búsqueda histórica.

[tools.ts](../src/lib/engine/tools.ts) define esquemas con `tool`/`jsonSchema`. `searchTools` descubre capacidades y esquemas; `executeTool` ejecuta el nombre exacto. La selección inicial se basa en reglas del prompt: el nombre `selectToolsWithAI` no implica que haya un router LLM activo. El descubrimiento dinámico permite llegar a herramientas fuera de esa selección.

El SDK instalado y sus guías en `node_modules/ai/docs/` son la referencia para cambios. El registro npm devolvió `7.0.127` durante esta revisión: seguimos en v7, pero hay versiones posteriores. Esta auditoría no actualiza paquetes ni adopta nuevas APIs.

## Plugins y skills: qué funciona y qué falta

[main.ts](../electron/main.ts), en `listAgentPlugins`, descubre `plugin.json`, `skills/<nombre>/SKILL.md` y `mcp.json` en el almacenamiento global o del proyecto. En conflictos de nombre prevalece el paquete del proyecto. Las tools pueden crear paquetes y comprobar que sus archivos se escribieron.

Codeclub también incluye el paquete MIT [Agent Skills de Addy Osmani](https://github.com/addyosmani/agent-skills) como plugin global de solo lectura. Sus skills se descubren con el catálogo normal y cargan sus recursos Markdown vinculados junto a las instrucciones. Al elegir una skill desde el menú `/`, el agente recibe sus instrucciones en esa sesión; para tareas de código sustanciales, también puede buscar una skill aplicable bajo demanda. La versión incorporada está indicada en `vendor/agent-skills/plugin.json` y el aviso de licencia se conserva en `vendor/agent-skills/LICENSE`.

`searchPlugins` y `searchSkills` entregan metadatos; `loadSkill` entrega instrucciones completas a demanda. No se inyectan todas las skills en cada prompt. El lector actual extrae `name` y `description` mediante expresiones regulares: no es un parser YAML completo. Los archivos auxiliares de una skill no tienen una API general de lectura expuesta por ese descubrimiento.

El cliente conecta stdio, Streamable HTTP y SSE legacy, conserva `PLUGIN_DATA`, expone tools con prefijos y ofrece cleanup de conexiones. Si un servidor falla, otros pueden seguir disponibles. Esto es integración real, pero no basta para declararnos cliente conforme a [Agent Plugins 1.0.0](https://agent-plugins.org/client-implementers/conformance).

Brechas observadas frente al checklist:

- El loader no valida estrictamente `$schema`, campos obligatorios, versiones coincidentes ni los esquemas cerrados de manifest/MCP. `warnings` se devuelve vacío y varios errores se omiten silenciosamente.
- Las comprobaciones de command/cwd de stdio usan prefijos de cadenas. Falta comprobar límites de directorio y rutas resueltas, incluidos enlaces. La expansión de placeholders se aplica a args/cwd, pero falta en valores de `env`.
- No hay una validación explícita del cliente para URL/headers y su política de redirecciones entre orígenes. Se debe comprobar esa política antes de declarar conformidad.
- `mcpRequest` no tiene timeout; la salida del proceso no rechaza explícitamente todas las solicitudes pendientes. La negociación y los fallos de lifecycle necesitan pruebas propias.

Las reglas de transporte, placeholders y aislamiento están detalladas en [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime). Estas brechas se identificaron leyendo código; esta revisión no ejecutó servidores MCP reales de los tres transportes.

## Autonomía: evidencia y límites

| Capacidad | Implementación actual | Límite relevante |
| --- | --- | --- |
| Planes y TODOs | Tools y estado persistido en `agent-state.json`. | El modelo debe usarlos; no constituyen un workflow obligatorio. |
| Memoria | SQLite, extractos acotados y búsqueda de conversaciones. | No es recuperación semántica ni memoria de preferencias aprendidas. |
| Instrucciones del repositorio | El runner programado lee `AGENTS.md` raíz con límite de tamaño. | El sistema del chat normal no carga automáticamente `AGENTS.md`; tampoco hay resolución jerárquica general. |
| Verificación | Resultados de tools, snapshots/diffs y registro visible. Existe `verifyToolExecutionWithAI`. | La función verificadora no está conectada al flujo normal del chat; texto final no equivale a éxito verificado. |
| Reintentos | Se eliminó el replay de `runAssistant`. El SDK conserva reintentos de transporte; el grafo añade espera cancelable y hasta dos reintentos para límites de streaming solo si el paso no llamó herramientas. | Los límites persistentes terminan con error. No hay garantía de exactamente una ejecución en sistemas externos ni registro durable de idempotencia. |
| Delegación | Existen implementaciones de subagent/swarm en tools. | El chat normal las filtra del conjunto disponible; las tareas también las excluyen. No anunciar delegación general activa. |
| Ejecución durable | Historial y tareas sobreviven reinicios; hay recuperación del estado del scheduler. | No hay checkpoints por paso para reanudar un loop interrumpido desde la última tool. |
| Observabilidad | Uso de tokens y registros locales de tools. | No hay trazas LangSmith ni integración activa de DevTools ni benchmark integral de calidad. |

LangGraph ofrece capacidades adicionales de persistencia y ejecución durable, que requieren configurar almacenamiento/checkpoints. Deep Agents agrupa contexto, filesystem, skills y delegación, pero no está integrado. La tabla refleja lo habilitado en Codeclub. Fuentes: [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview), [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview).

## Qué se ha verificado

Las pruebas de chat cubren historial largo, presupuesto de contexto, streaming con proveedor simulado y persistencia. Las pruebas de tareas cubren reloj, scopes, cola, cancelación, aprobaciones y recuperación. Hubo además una prueba real con Electron y Gateway: el modelo se eligió del catálogo con precio de entrada/salida cero, leyó un archivo mediante una tool y guardó la respuesta y consumo. La credencial se cifró en un perfil temporal y ese perfil se eliminó.

El 2026-10-04 también terminó un ciclo real de desarrollo en Salieri con modelo gratuito del catálogo: lectura/escritura, plan completado, 21 tests, build, servidor en terminal y nueve acciones del navegador con filtro, envío local y reinicio. La [verificación de desarrollo](development-verification.md) resume la evidencia y las correcciones. Esto valida recorridos concretos, no todos los proveedores, todas las tools, compatibilidad completa de plugins ni calidad en proyectos complejos. Ver [catálogo y transporte de IA](ai-catalog.md), [tareas programadas](scheduled-tasks.md) y [historiales](revision-chat-historiales.md).

La integración LangGraph/LangChain se valida con `npm run test:agent-graph`: continuación multipaso con una tool de efectos, input inválido rechazado antes del efecto, cancelación, límite de pasos, cierre único, tokens agregados y fallo de transporte después de una tool sin reproducir el efecto anterior. `test-scheduled-tasks.mjs` vuelve a ejecutar el runner compartido con proveedor simulado. La revisión de desarrollo del 2026-10-04 utiliza esta integración con una credencial real en un perfil temporal cifrado y los componentes reales de chat/navegador. El protocolo y los resultados se documentan en [verificación de desarrollo](development-verification.md); sus informes distinguen un ciclo completo de un intento incompleto.

## Mejoras recomendadas, en orden

1. **Completar idempotencia:** tras eliminar el replay del flujo completo, clasificar fallos y registrar identificadores durables de ejecución de tools.
2. **Compartir instrucciones y verificación:** cargar reglas del proyecto en chat/tareas y exigir evidencia antes de marcar un objetivo completado.
3. **Cerrar compatibilidad de plugins:** schemas locales, límites de rutas reales, env, redirecciones, timeouts y pruebas MCP por transporte.
4. **Medir calidad:** conjunto de tareas reproducibles de lectura, cambios, pruebas, navegador y recuperación; medir éxito, costo y duración por modelo seleccionado dinámicamente.
5. **Extender trabajos largos si las mediciones lo requieren:** checkpoints por paso, contexto mejor resumido y delegación con scopes y presupuesto claros.

LangGraph y LangChain ya están instalados y conectados al motor compartido. Estas mejoras pendientes no se consideran implementadas por la mera instalación.

## Cómo mantener este documento

Actualizarlo cuando cambien `engine/run.ts`, `engine/tools.ts`, `ChatInterface`, `ScheduledTaskRunner`, `agent-plugins.ts` o el loader/MCP nativo. Separar siempre «existe en código», «está disponible para el agente» y «fue probado». Para APIs del SDK, leer las guías instaladas; para conformidad, consultar la versión del estándar soportada sin descargar schemas durante la carga de paquetes.
