# Catálogo y rutas de IA

Los selectores existentes usan la unión de models.dev y del endpoint público
`https://ai-gateway.vercel.sh/v1/models`. Gateway aporta modelos de tipo
language: el chat usa las APIs de generación de texto del SDK.

Se conservan proveedor, endpoint, nombre e identificador de los modelos directos.
Si un modelo existe en ambos catálogos, se muestra una vez bajo su proveedor y
queda también disponible en la opción existente AI Gateway. Esa opción incluye
solo modelos que el catálogo de Gateway confirma disponibles.

Los modelos nuevos de Gateway aparecen bajo su creador en el mismo selector.
`gatewayOnly` en el modelo determina su ruta incluso si ese creador ya tenía
modelos directos. Los creadores exclusivos de Gateway usan el mismo indicador
en el proveedor. No hay pantallas ni controles nuevos.

`ai-routing.ts` centraliza pertenencia al proveedor, ruta, identificador de
ejecución y clave de almacenamiento. La ruta directa conserva su ID local y
`<proveedor>_api_key`; Gateway usa `creador/modelo` y `ai_gateway_api_key`.
El diálogo existente muestra Vercel AI Gateway cuando corresponde. Una clave
de Gateway guardada se reutiliza al cambiar entre sus modelos.

El chat, la resolución de herramientas y los contextos de herramientas reciben
el mismo identificador resuelto. Los selectores de tareas también filtran con
la misma pertenencia y cargan la credencial adecuada cuando cambia la ruta.

Cada fuente conserva su manejo independiente de errores: si falla una, el
catálogo de la otra sigue disponible. No se selecciona automáticamente un
modelo ajeno cuando el proveedor elegido no tiene modelos disponibles.

## Verificación

`node scripts/test-ai-catalog.mjs` prueba catálogos mixtos, modelos compartidos,
modelos exclusivos de Gateway dentro de un proveedor directo, creadores nuevos,
identificadores de ejecución, credenciales y caída independiente de cada fuente.
Las pruebas usan respuestas de catálogo controladas y no envían generaciones
ni usan credenciales reales.

## Credenciales, transporte y errores

Los proveedores y modelos seleccionables se obtienen de models.dev y del catálogo público de Vercel AI Gateway. Los precios desconocidos se conservan como desconocidos; no equivalen a cero. Gateway conserva su precio por ruta separado del precio del proveedor directo y su ventana de contexto. No existe un endpoint de proveedor como fallback: si el catálogo no indica uno compatible, se muestra un error de configuración.

La credencial Gateway se guarda en `credentials.encrypted.json`, cifrada por Electron safeStorage/DPAPI y vinculada al origen del servicio. No se guarda en mensajes, pruebas ni documentos. Las pruebas en vivo reciben la credencial por stdin, sin argumentos ni archivos de texto plano. La selección gratuita usa precios actuales y capacidad de herramientas; no fija IDs de modelos en el código.

## Sesión y errores

Las solicitudes directas se identifican como Codeclub y llevan un ID estable de chat. Encabezados adicionales de sesión se configuran por proveedor en el ajuste `codeclub_provider_headers_<id>`; `${chatId}` se sustituye por el ID del chat. No hay condiciones de código por nombre de proveedor. Authorization, Cookie y Host no se aceptan como encabezados configurables.

El motor conserva el primer error real del stream, evitando reemplazarlo por un error genérico de falta de salida. La interfaz distingue requisitos de pago, suscripción y restricciones del cliente antes de interpretar un HTTP 403 como credencial inválida. Los mensajes se traducen al español e inglés.

Las pruebas con un proveedor de fixture validan el transporte, el almacenamiento cifrado, la cancelación, el historial compartido, las superficies ADE/widget y los errores de cuenta. Estas pruebas no requieren credenciales reales ni verifican la disponibilidad o las restricciones de una cuenta externa.
