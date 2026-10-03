# Revisión del chat con historiales largos

Fecha: 3 de octubre de 2026. Se implementaron límites de contexto y memoria, páginas visuales de 15 turnos, virtualización de turnos y almacenamiento SQLite con escrituras incrementales. La lectura de una página usa un contador de solicitud para no reemplazar un chat abierto después.

El resumen histórico procesa como máximo 500 mensajes por actualización y conserva un extracto acotado. La búsqueda consulta SQLite y la migración conserva historiales anteriores. La vista mantiene hasta 400 mensajes alrededor del usuario; el historial completo sigue persistido.

## Persistencia y puente nativo

Electron guarda `chats.sqlite` en el directorio de datos de la aplicación, con WAL y transacciones. La clave separa proyecto y chat; las rutas Windows se normalizan. Los historiales globales anteriores se migran desde settings antes de iniciar el renderer. Los JSONL de proyectos se importan al abrirlos y se conservan como respaldo. Una eliminación deja una marca para evitar que reaparezca un historial antiguo.

El preload expone `chatTurns` (proyecto, chat, cursor, cantidad, dirección), `chatPage` (mensajes acotados), `chatContext`, `chatAppend`, `chatSaveTail`, `chatSearch`, `chatCopy`, `chatDelete` y `chatTranscript`. Sus consumidores son el hook de historial, ChatInterface y projectManager; los handlers `chats:*` viven en main.ts. No se agregaron eventos internos. Las escrituras de cola verifican el total esperado para rechazar cambios concurrentes; reintentar conserva el prefijo no cargado. Los transcripts son archivos individuales con append, fuera de settings.

## Interfaz y contexto

La vista conserva hasta 400 mensajes y monta solo turnos cercanos al viewport con TanStack Virtual. Carga hacia arriba y abajo, mantiene el anclaje y abre en el último turno. Las ventanas ordinarias respetan límites de turnos; un turno excepcional que exceda el límite se recorta en la vista. El archivo persistido conserva todos sus mensajes.

Los cambios de chat encadenan salida (90 ms), carga y ajuste del scroll ocultos, y entrada (140 ms). El contador de solicitud descarta selecciones reemplazadas incluso durante la salida. La preferencia de movimiento reducido elimina las duraciones; el cleanup detiene animaciones pendientes. La paginación espera a que termine la transición y los mensajes históricos no repiten animaciones al montarse. La prueba de interfaz muestrea fotogramas para comprobar ausencia de superposición y que el scroll esté ubicado antes de revelar el siguiente chat; también cubre volver a un chat vacío.

La carga inicial que completa un viewport corto se hace antes de la entrada. El scroll usa únicamente el final del virtualizador, sin un segundo ajuste directo del DOM ni espacios externos que alteren su cálculo. La entrada espera cuatro fotogramas con altura, scroll, viewport y posición del último turno estables; un chat en generación usa un fotograma para permitir mostrar streaming. También espera fuentes e imágenes montadas. La regresión con 10.000 mensajes de alturas variables mide la posición del último turno durante y después de la entrada, con tolerancia menor a un píxel.

Cada generación consulta hasta 80 mensajes recientes. El presupuesto usa bytes UTF-8 como estimación conservadora, limita los extractos históricos y reserva espacio para instrucciones, herramientas y salida. No es un tokenizer exacto. Los extractos son incompletos y se identifican como contenido no confiable; `searchChats` recupera fragmentos antiguos. En pasos de herramientas se podan resultados viejos antes de superar el presupuesto. Un mensaje demasiado grande produce un error claro en lugar de truncarse silenciosamente.

## Verificación

`npm run test:chat-history` compila Electron y valida 10.000 mensajes: migración, separación de proyectos, paginación en ambas direcciones, conflictos, rollback, reintentos, búsqueda literal, copia, reapertura y eliminación sin reimportación. También comprueba el presupuesto Unicode y los límites de ventanas.

`npm run test:chat-ui` compila la aplicación y abre ChatInterface en Edge headless con un perfil temporal, SQLite temporal y un proveedor local simulado. Validó apertura al último mensaje, carga anterior, carrera entre chats, respuesta del SDK y persistencia incremental, contexto acotado y regeneración conservando el historial no cargado. En el caso de 10.000 mensajes solo quedaron 9 turnos montados. La prueba no toca chats ni credenciales reales.

Se verificaron `next:build`, `electron:compile`, TypeScript y `git diff --check`. Esto no promete mensajes literalmente infinitos: disco, tamaño de cada mensaje y contexto del modelo son finitos. La compatibilidad con proveedores reales y la interacción manual completa de proyecto, idioma, terminal y paneles no están cubiertas por el proveedor simulado. Reiniciar Electron activa el nuevo puente y la migración.
