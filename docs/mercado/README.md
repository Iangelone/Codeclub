# Mercado: esquema inicial

`schema.sql` crea únicamente el esquema `mercado`; no modifica `public` ni la interfaz local.
Aplicado mediante MCP en el proyecto Supabase Codeclub (dtlifqfupxododxermsu), migración create_mercado_schema, el 7 de octubre de 2026.

## Entidades

- `perfiles`: identidad pública vinculada a `auth.users`. Una misma persona consume y provee.
- `equipos`: PCs del proveedor. Solo su dueño puede consultarlas o modificarlas.
- `modelos`: ofertas públicas habilitadas, asociadas a una PC del mismo proveedor.
- `solicitudes`: pedidos privados visibles solo para consumidor y proveedor involucrados.

Las cuentas se crean con Supabase Auth; luego el usuario inserta su perfil con su propio UUID.
El uso exclusivamente local de Codeclub sigue sin requerir cuenta.

## Aplicación

1. Elegir el proyecto Supabase y ejecutar `schema.sql` una sola vez en SQL Editor.
2. Agregar `mercado` a los schemas expuestos en Data API para permitir acceso desde la app.
3. Usar la URL pública y publishable key con una sesión de Supabase Auth.
4. Acceder con `supabase.schema('mercado').from('modelos')`.

Documentación: https://supabase.com/docs/guides/api/using-custom-schemas

## Alcance de esta primera base

- RLS habilitada y grants explícitos. Sin acceso para usuarios sin sesión.
- El catálogo muestra modelos habilitados; eso NO garantiza disponibilidad del equipo.
- API keys, credenciales de modelos y endpoints privados permanecen en el vault/configuración local.
- El heartbeat y el estado real online requieren una RPC con hora del servidor y vencimiento.
- Las solicitudes nacen pendientes. Los clientes no pueden actualizar ni eliminar solicitudes.
- Ejecución, respuestas, streaming, cancelaciones y transiciones atómicas se implementarán después.
- Los límites son configuración: todavía no hay enforcement de cuota, cola ni simultáneas.
- Un modelo con solicitudes no puede eliminarse físicamente: debe deshabilitarse para preservar referencias.
- No se implementan pagos ni saldos. Su verificación deberá ejecutarse en infraestructura confiable.

## Verificación

La migración se aplicó correctamente. Se consultaron RLS, políticas y permisos de acceso al esquema. El rol anon no tiene USAGE; authenticated sí.
El advisor detectó avisos preexistentes de EXECUTE sobre public.rls_auto_enable(); no se modificó esa función ajena a mercado.
Verificado el 7 de octubre de 2026: schema expuesto, cuenta confirmada y sesión restaurada al recargar Electron.
`verify.sql` comprobó con dos identidades temporales los permisos de catálogo, equipos privados, edición propia, solicitudes y protección de referencias; la transacción se revirtió.
`node scripts/verify-market.mjs` comprobó contra Data API los helpers reales de sesión, perfil, equipo, publicación, edición, pausa y borrado. Requiere una sesión de escritorio existente y crea datos temporales; si crea un perfil, su limpieza requiere SQL administrativo porque el cliente no tiene permiso DELETE sobre perfiles.
Se retiraron los datos temporales de esta ejecución. No se probó inferencia remota, todavía pendiente de implementar.

## Integración de Codeclub

- Cliente `@supabase/supabase-js` fijado en 2.117.3, configuración pública en `src/lib/market-cloud.ts`.
- Mercado tiene registro e inicio de sesión por email/contraseña. Si el proyecto requiere confirmar email, copiar la dirección del botón del correo y pegarla en Confirmar email dentro de Codeclub.
- La app guarda la sesión cifrada con Windows DPAPI mediante `MarketSessionStore` y un bridge IPC limitado a las claves de sesión de Mercado. En navegador, usa sessionStorage.
- Reiniciar completamente Electron tras esta actualización para cargar el nuevo preload.
- Primera publicación: crea/actualiza perfil, registra esta PC y publica el modelo. No sube API keys ni endpoints privados.
- Estado administra ofertas de esta PC vinculadas a la cuenta actual. Las ofertas locales anteriores se publican explícitamente con el icono de subida.
- Proveedores consulta el catálogo online y lo refresca cada 15 segundos mientras Mercado está abierto; desconectado no muestra el catálogo de otra sesión.
- Editar, pausar y eliminar sincronizan Supabase antes de actualizar el registro local. El nombre público pertenece al perfil y se comparte entre sus modelos.
- Conectarse guarda una suscripción local por cuenta y agrega la oferta online a los selectores del chat; Desconectarse la retira. La ejecución remota sigue pendiente: el chat la bloquea antes de consultar credenciales o enviar una petición. Los aliases locales ya existentes siguen siendo locales y nunca sirven para ejecutar ofertas remotas con credenciales propias del consumidor.
- `codeclub:market-providers-changed`: emiten las mutaciones locales tras persistir; payload `{ providerId: string }`; escuchan MarketPanel y useMarketCatalog; ambos retiran el listener en el cleanup de su useEffect.
- Auth utiliza `onAuthStateChange`; MarketAccount cancela su suscripción al desmontarse. El polling de catálogo también se cancela al desmontar/cambiar cuenta.
- Permisos SQL consultados por MCP: SELECT de catálogo, INSERT de modelos/equipos y UPDATE de etiqueta/estado/perfil habilitados para authenticated.
- El usuario creó y confirmó su cuenta e inició sesión. La sesión y las operaciones de publicación se verificaron con esa cuenta; no se enviaron correos automáticamente.

## Confirmación de email en escritorio

El servicio de correo por defecto del proyecto limita editar plantillas a SMTP propio o Pro (observado en Dashboard el 7 de octubre de 2026). No se deshabilitó la confirmación ni se cambió el Site URL.
La app acepta el enlace original de signup de este proyecto y valida su hash con `auth.verifyOtp`, tipo email. No navega a `redirect_to`, no persiste el enlace y no lo registra en logs. Solo acepta el origin de Auth configurado, ruta `/auth/v1/verify` y tipo signup.
Si ya se abrió el enlace y se confirmó el usuario, alcanza con iniciar sesión normalmente. Si expiró o se usó, Reenviar correo solicita un enlace nuevo; el usuario debe accionar ese botón.
No se consumió automáticamente el enlace compartido en el chat. No se verificó un token real ni se enviaron correos durante la implementación.

Las conexiones se guardan por cuenta en `codeclub_market_connections_<uuid>`, separadas de las ofertas propias. El evento `codeclub:market-providers-changed` también lo emite `setPublishedProviderConnection`, con `{ providerId: string }`; MarketPanel y useMarketCatalog lo consumen y retiran sus listeners al desmontarse. El catálogo del chat se actualiza cada 15 segundos y limpia las ofertas al cambiar la sesión.
