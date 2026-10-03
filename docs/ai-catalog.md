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
