# Verificación de catálogos y transporte

Los proveedores y modelos seleccionables se obtienen de models.dev y del catálogo público de Vercel AI Gateway. Los precios desconocidos se conservan como desconocidos; no equivalen a cero. Gateway conserva su precio por ruta separado del precio del proveedor directo y su ventana de contexto. No existe un endpoint de proveedor como fallback: si el catálogo no indica uno compatible, se muestra un error de configuración.

La credencial Gateway se guarda en `credentials.encrypted.json`, cifrada por Electron safeStorage/DPAPI y vinculada al origen del servicio. No se guarda en mensajes, pruebas ni documentos. Las pruebas en vivo reciben la credencial por stdin, sin argumentos ni archivos de texto plano. La selección gratuita usa precios actuales y capacidad de herramientas; no fija IDs de modelos en el código.

## Resultado de las pruebas reales del 3 de octubre de 2026

Las solicitudes iniciales salieron desde la aplicación Electron mediante su transporte nativo y la primera credencial cifrada. Ninguna ruta inicial completó una respuesta real debido a restricciones de las cuentas:

- Gateway devolvió que necesita una tarjeta válida registrada para habilitar solicitudes, incluso las de los modelos gratuitos consultados.
- El proveedor directo con suscripción devolvió que la cuenta no tiene la suscripción activa requerida.
- El proveedor directo con nivel gratuito devolvió que ese nivel solo puede usarse desde su propia aplicación.

La primera credencial quedó configurada y un modelo gratuito del catálogo actual quedó seleccionado. Esa primera prueba no registró ninguna respuesta real exitosa.

La revisión final confirmó HTTP 403 en Gateway por REST y por el SDK. Los catálogos autenticados de ambos proveedores directos devolvieron HTTP 200; su generación devolvió las restricciones de cuenta anteriores. Compilación web, compilación Electron, catálogo dinámico, historial de 10.000 mensajes y pruebas del flujo de chat completaron sus verificaciones.

## Nueva credencial: respuesta real confirmada

La segunda credencial proporcionada el mismo día completó una solicitud REST con HTTP 200 y una generación por el SDK desde el chat de Electron (`VALIDACION_OK`). También completó una segunda generación desde el widget (`WIDGET_OK`), mostrando únicamente la última respuesta del agente y ningún mensaje del usuario. Se usó Ling 3.1 Flash Free de InclusionAI, seleccionado dinámicamente entre las entradas gratuitas con herramientas del catálogo actual; el identificador solo se persiste como preferencia del usuario, no como modelo fijo del código. La clave quedó cifrada con la clave del perfil original. Las restricciones de las credenciales directas anteriores no cambian con una clave Gateway nueva.

La prueba del widget espera la animación de apertura, expande el compositor y espera la carga del chat antes de enviar. Así evita confundir el panel contraído o el mensaje anterior con una respuesta fallida.

Después de reiniciar la aplicación habitual para cargar el vault actualizado, Computer Use preparó y envió un mensaje desde su compositor. La interfaz y el historial del proyecto mostraron la respuesta real `REVISION_OK`, confirmando también la persistencia de la nueva credencial y selección fuera del perfil aislado de pruebas.

Se corrigió un error del entorno de pruebas: en Windows, safeStorage utiliza también la clave cifrada del perfil Chromium en `Local State`. Copiar solo el vault entre perfiles independientes impide descifrarlo. El perfil aislado de validación ahora conserva esa clave cifrada del perfil original antes de arrancar Electron. Se restauraron las entradas afectadas con las credenciales existentes, sin texto plano en archivos nuevos, y se verificó su transporte nativo. La reparación exige una variable explícita de QA; las pruebas normales no modifican el vault original.

## Sesión y errores

Las solicitudes directas se identifican como Codeclub y llevan un ID estable de chat. Encabezados adicionales de sesión se configuran por proveedor en el ajuste `codeclub_provider_headers_<id>`; `${chatId}` se sustituye por el ID del chat. No hay condiciones de código por nombre de proveedor. Authorization, Cookie y Host no se aceptan como encabezados configurables.

El motor conserva el primer error real del stream, evitando reemplazarlo por un error genérico de falta de salida. La interfaz distingue requisitos de pago, suscripción y restricciones del cliente antes de interpretar un HTTP 403 como credencial inválida. Los mensajes se traducen al español e inglés.

Las pruebas con un proveedor de fixture validan el transporte, el almacenamiento cifrado, la cancelación, el historial compartido, las superficies ADE/widget y los errores de cuenta. Se distinguen de las pruebas reales bloqueadas por los servicios externos.
