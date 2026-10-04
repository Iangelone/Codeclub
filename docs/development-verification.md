# Verificación de desarrollo con modelo gratuito

## Reproducir

Desde Codeclub, con una carpeta de prueba existente y autorizada:

```powershell
node scripts/test-development-live.mjs 'C:\ruta\absoluta\al\proyecto'
node scripts/verify-development-site.mjs 'C:\ruta\absoluta\al\proyecto'
```

La primera prueba solicita la credencial por stdin sin eco, o toma `AI_GATEWAY_API_KEY`. Consulta el catálogo vigente de Gateway y elige un modelo de lenguaje con herramientas y precios de entrada/salida cero. Prioriza descripciones de programación y contexto disponible; no fija ningún identificador de modelo o proveedor. `CODECLUB_FREE_MODEL_INDEX` permite probar otro candidato del catálogo. `CODECLUB_DEVELOPMENT_PROMPT` permite revisar un proyecto ya creado con una consigna específica; conserva los mismos requisitos de evidencia del evaluador.

Ejecuta los componentes reales de chat y navegador, el motor LangGraph/LangChain/AI SDK y Electron/preload. Un perfil temporal cifra la credencial y se elimina al terminar. No modifica las credenciales del usuario. Aprueba solamente los efectos del ciclo de desarrollo autorizado en la carpeta indicada. Esta aprobación pertenece al evaluador; no cambia la política normal de permisos de la app.

El modelo inspecciona archivos, crea un plan, programa la web, ejecuta tests/build, inicia el servidor en un PTY y utiliza el WebView para probar filtros y enviar un formulario local. El evaluador exige resultados de herramientas, checks con salida cero, botón de confirmación visible y plan completado. Puede solicitar continuidad si una respuesta termina antes del objetivo. Los informes sin credenciales quedan en `.codeclub-qa/`: conversación, auditoría y resultado. La comprobación independiente verifica rutas, recursos, errores JS, ancho móvil/escritorio, filtro, validación, persistencia local y reinicio del formulario.

## Correcciones descubiertas durante la prueba

- Descubrimiento: `searchTools` entrega el JSON Schema real, sin el envoltorio del SDK. `executeTool` acepta un objeto o un objeto codificado como JSON y valida también los argumentos de la herramienta descubierta con LangChain antes de ejecutar su efecto. JSON inválido, arrays, null, campos ausentes/tipos incorrectos y propiedades extra se rechazan; no se corrigen nombres o argumentos inventados.
- Continuación: un error de herramienta vuelve al modelo para corregir argumentos; no termina el grafo prematuramente. Se conserva la metadata de llamadas/resultados que el SDK expone mediante getters.
- Windows: `runCommand` utiliza un PTY aislado, argumentos literales y el código real del comando. El supervisor mantiene vivo el dueño de la consola hasta cerrar sus procesos, incluidos los iniciados en segundo plano. El timeout es configurable (120 segundos por defecto). Su salida combina stdout/stderr en `stdout`, sin controles ANSI; no mantiene servidores. La terminal persistente normaliza Enter a CR, que espera el PTY de Windows. `npm run test:native-commands` comprueba argumentos, `.cmd`, errores, timeout y cierre de descendientes, incluso después de que haya terminado su padre.
- Navegador: un estado fallido conserva `ok: false`; los select muestran opciones/valores, los checkbox su estado y escribir en un select valida la opción. Cada acción devuelve el DOM actualizado y referencias nuevas para la siguiente acción, reduciendo consultas al modelo. `getBrowserState` vuelve a observar si la página cambia o el estado no está disponible.
- Registro: el chat guarda el resultado final de la ejecución de cada herramienta e informa el error incluso cuando hubo texto parcial antes del fallo.
- Trabajo largo: el chat permite hasta 128 pasos por ejecución, con cancelación y presupuesto de contexto; no significa éxito automático ni ejecución ilimitada.
- Límites de uso durante streaming: el grafo puede esperar y reintentar el paso de generación hasta dos veces si no solicitó herramientas. La espera es cancelable (30/60 segundos por defecto, con `retry-after` numérico cuando existe, máximo 60 segundos por espera). Si hubo llamadas de herramientas en ese paso, falla sin reproducirlas. Un límite persistente se informa; no activa otro modelo silenciosamente.

## Resultado comprobado el 2026-10-04

La prueba final en `C:\Users\iange\OneDrive\Documents\Proyectos\Salieri` terminó con `agentCycleComplete: true`, sin errores del renderer y con el plan persistido como completado. Usó `poolside/laguna-s-2.1-free`, seleccionado entre los candidatos del catálogo vivo de Gateway, con entrada/salida a precio cero. Ese identificador describe el resultado observado; no es una selección fija en el producto ni en el evaluador.

El modelo ejecutó `npm.cmd test` (21 pruebas aprobadas) y `npm.cmd run build` (4 HTML, 54 enlaces y 10 archivos) con código cero. Inició el servidor mediante la terminal persistente y realizó nueve acciones exitosas del navegador: filtro «Mezcla» con 3/12 proyectos, formulario completo, confirmación visible y reinicio. Leyó/escribió archivos y verificó su README antes de terminar. La web se construyó y corrigió durante varios intentos; el recorrido final revisó esos archivos. No se confunde un intento parcial con la ejecución final aprobada.

La revisión independiente volvió a aprobar las cuatro rutas y recursos en anchos de 1440/390 px, ausencia de desbordamiento horizontal y errores JavaScript, filtro, cinco errores de validación, confirmación, mensaje en localStorage y reinicio. Las evidencias están en `.codeclub-qa/result.json`, `chat.json`, `execution.jsonl` e `independent.json` dentro de Salieri.

Las compilaciones de Next/Electron, TypeScript y `git diff --check` pasaron. Las regresiones cubren el grafo, los argumentos dinámicos, el runner de tareas, el chat, el arranque y la ejecución nativa de comandos. La compatibilidad de argumentos JSON serializados y la validación anidada se añadieron después del recorrido final y se verificaron con efectos simulados, incluidos inputs rechazados sin efecto. Después volvió a pasar una tarea automática real con `inclusionai/ling-3.0-flash-sante`, también gratuito y elegido del catálogo: lectura comprobada, una ejecución, resultado persistido, consumo registrado y credencial cifrada. Su consigna solicitó argumentos codificados como JSON; el evaluador comprueba la lectura efectiva, no certifica la forma exacta de la llamada del modelo.

## Alcance

La prueba comprueba un recorrido concreto con un modelo elegido en el catálogo vigente. No demuestra compatibilidad universal ni garantiza la calidad de cualquier modelo gratuito. Durante la revisión del 2026-10-04 un candidato gratuito devolvió `RateLimitError`: precio cero no implica uso ilimitado. Se probó otro candidato del mismo catálogo mediante el índice de prueba; la app no cambia automáticamente el modelo elegido por el usuario. El sitio de prueba usa Node sin dependencias externas y una confirmación de contacto local: no despliega ni envía mensajes a terceros. El grafo sigue sin checkpoints para retomar un nodo después de cerrar la app.
