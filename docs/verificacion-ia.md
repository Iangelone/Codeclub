# Verificación de catálogos y transporte

Los proveedores y modelos seleccionables se obtienen de models.dev y del catálogo público de Vercel AI Gateway. Los precios desconocidos se conservan como desconocidos; no equivalen a cero. Gateway conserva su precio por ruta separado del precio del proveedor directo y su ventana de contexto. No existe un endpoint de proveedor como fallback: si el catálogo no indica uno compatible, se muestra un error de configuración.

La credencial Gateway se guarda en `credentials.encrypted.json`, cifrada por Electron safeStorage/DPAPI y vinculada al origen del servicio. No se guarda en mensajes, pruebas ni documentos. Las pruebas en vivo reciben la credencial por stdin, sin argumentos ni archivos de texto plano. La selección gratuita usa precios actuales y capacidad de herramientas; no fija IDs de modelos en el código.

## Sesión y errores

Las solicitudes directas se identifican como Codeclub y llevan un ID estable de chat. Encabezados adicionales de sesión se configuran por proveedor en el ajuste `codeclub_provider_headers_<id>`; `${chatId}` se sustituye por el ID del chat. No hay condiciones de código por nombre de proveedor. Authorization, Cookie y Host no se aceptan como encabezados configurables.

El motor conserva el primer error real del stream, evitando reemplazarlo por un error genérico de falta de salida. La interfaz distingue requisitos de pago, suscripción y restricciones del cliente antes de interpretar un HTTP 403 como credencial inválida. Los mensajes se traducen al español e inglés.

Las pruebas con un proveedor de fixture validan el transporte, el almacenamiento cifrado, la cancelación, el historial compartido, las superficies ADE/widget y los errores de cuenta. Estas pruebas no requieren credenciales reales ni verifican la disponibilidad o las restricciones de una cuenta externa.
