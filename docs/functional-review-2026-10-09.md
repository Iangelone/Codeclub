# Revisión funcional — 9 de octubre de 2026

Se revisaron los flujos existentes de chat, historial, ejecución del agente, descubrimiento y validación de tools, plugins/MCP, tareas/orbes, persistencia, ventanas/sesiones, navegador y terminal. No se añadieron pantallas, funciones de producto, modelos ni dependencias.

## Correcciones

| Área | Fallo y cambio |
| --- | --- |
| MCP stdio | Las solicitudes podían quedar pendientes al terminar el servidor. Ahora tienen plazos, rechazan al cerrar el transporte y limpian procesos tras fallos de inicialización o cierre explícito. |
| Rutas MCP | La comparación por prefijo aceptaba carpetas hermanas y junctions externas. Se comprueban límites y rutas reales; env también expande las variables del plugin. |
| MCP remoto | Se registra el cierre antes de descubrir tools, conservando la limpieza si esa consulta falla. |
| Dispatcher | `isError=true` de MCP se propagaba como éxito. Ahora devuelve fallo; cancelar rechaza como cancelación sin ejecutar efectos adicionales. |
| Tareas | Reemplazar el objeto durante una ejecución perdía la pausa de un orbe que fallaba después de editarlo. Se conserva su identidad; iniciar el scheduler dos veces tampoco duplica su timer. |
| Logs | Cada entrada releía y reescribía todo el historial; ventanas concurrentes podían perder entradas. Electron serializa anexados por archivo. Los objetos largos conservan un extracto marcado como truncado en lugar de `[object Object]`. |
| Historial | Cursores y límites no finitos de páginas por turno llegaban a SQLite. Se normalizan igual que en la paginación ordinaria. |
| Motor | Límites de pasos o contexto no finitos ya no desactivan el presupuesto. El total de tokens usa entrada + salida cuando el proveedor omite el total. |
| Chat | Imágenes o fuentes pendientes podían dejar la conversación oculta indefinidamente. Se limita la espera de estabilización a dos segundos. |
| Proyecto y ajustes | Cargas tardías de metadatos, plugins, recientes y selección de proveedor/modelo ya no reemplazan respuestas más nuevas. Fallar al leer ajustes no deja el chat esperando su inicialización para siempre. |
| Catálogo | Las dos fuentes se consultan en paralelo con un plazo de 12 segundos, incluyendo la lectura del cuerpo; mantienen sus fallbacks independientes. |

`codeclub:append-log` es un IPC de solicitud/respuesta, no un evento de ventana: `appendDesktopLog` → preload `appendLog(filePath, content)` → Electron. Solo acepta los tres nombres de log existentes dentro de userData y valida rutas reales. La cola se elimina al terminar la última escritura. Los bridges anteriores conservan temporalmente el mecanismo previo hasta reiniciar Electron.

## Modelos y eficiencia

Se mantiene la selección del usuario y la arquitectura de un paso de AI SDK por nodo LangGraph. Las regresiones verifican que fallos posteriores a una tool no repiten sus efectos, que el descubrimiento promueve schemas exactos y que la compactación conserva evidencia actual, selectores y señales de medios.

La mejora de logs elimina la reescritura proporcional al tamaño del archivo en cada entrada; el test nativo comprueba 100 anexados concurrentes distintos. La carga paralela del catálogo elimina la espera secuencial entre fuentes. No se afirma una mejora porcentual de calidad, latencia de inferencia o costo de tokens: no se ejecutó un benchmark con proveedores comerciales reales.

El presupuesto de contexto sigue siendo una estimación conservadora por bytes, no un tokenizer exacto. El título de cada turno continúa requiriendo su llamada auxiliar existente. Tampoco se añadieron memoria semántica, checkpoints ni nuevas políticas de selección.

## Verificación

- Builds: `next:build`, `electron:compile` y `tsc --noEmit`.
- Motor: `test:agent-graph`, contratos de 46 tools con 165 entradas rechazadas y herramientas de computadora con bridge simulado.
- Persistencia: historial de 10.000 mensajes, scheduler, ajustes/orbes y sesiones/vault con fixtures aislados.
- Interfaz: chat real con proveedor simulado, panel de extensiones, sidebar, idioma, foco, redimensionado y persistencia.
- Navegador: CDP, selección DOM/editor de estilos, orígenes y reconexión de extensión, acciones en Chromium aislado.
- Sistema: terminal PTY real, comandos nativos, rutas Git, recursos de plugins y junctions.
- Nuevas regresiones: ciclo MCP, expansión de env, límites de rutas, anexado concurrente, tarea editada antes de fallar, límites no finitos, errores MCP, respuesta tardía de plugins y apertura de chat con una imagen cuya petición permanece bloqueada.
- `git diff --check` sin errores.

Estas pruebas cubren flujos concretos y fallos reproducibles. No certifican todas las combinaciones de proveedor/MCP, cortes de energía, reinstalación de Windows ni todos los casos límite posibles. Se requieren reinicio completo de Electron para el preload y los handlers nativos nuevos; recargar solamente React no los instala.
