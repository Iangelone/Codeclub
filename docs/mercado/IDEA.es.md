# Mercado de Codeclub

[English](IDEA.en.md) · [Implementación y esquema](README.md)

## Idea y objetivo

Mercado conecta personas que ofrecen acceso a modelos de IA con personas que quieren utilizarlos desde Codeclub. La plataforma actúa como intermediaria: descubre ofertas, identifica participantes y, en una etapa futura, coordina solicitudes y cobros. El proveedor aporta el modelo o el acceso a una API; el consumidor elige a quién contratar.

La intención comercial es pagar por uso con criptomonedas y que Codeclub retenga una comisión pequeña. Todavía no se eligieron moneda, red, tarifa, unidad de facturación ni porcentaje. El prototipo permite avanzar sin cobros; publicar una oferta no habilita pagos ni ejecución remota.

## Participantes

- **Usuario:** una cuenta de Supabase Auth puede consumir y proveer. El uso local de Codeclub no requiere cuenta de Mercado.
- **Proveedor:** tiene un nombre público y publica una o varias ofertas. Cada oferta identifica un modelo y tiene una etiqueta visible para consumidores.
- **Consumidor:** explora el catálogo y conecta las ofertas elegidas a sus selectores de chat.
- **Equipo:** una computadora registrada del proveedor. No es un equipo de personas: permite asociar ofertas a una PC y preparar reconexiones después de apagarla.
- **Codeclub:** administra el catálogo y las conexiones. La futura infraestructura deberá coordinar trabajos y verificar pagos.

## Oferta y registro

Desde **Varios → Mercado → Agregar**, el proveedor define nombre público, origen, modelo, etiqueta, peticiones por minuto, solicitudes simultáneas y cola opcional.

| Origen | Configuración | Credenciales |
| --- | --- | --- |
| Modelo local | URL con host y puerto opcional, por ejemplo un servidor Ollama o LM Studio, e identificador del modelo | Endpoint privado en la PC |
| Codeclub | Proveedor y modelo del catálogo existente de Codeclub | API key en el vault local; puede reutilizar una guardada |

Los selectores de proveedor/modelo del modal permiten búsqueda y abren hacia arriba. Los colores de selección respetan el orbe y el scroll usa el estilo de los otros modales.

El nombre público pertenece al perfil: cambiarlo afecta al nombre mostrado en todas sus ofertas. La etiqueta pertenece a cada oferta. Límites actuales del formulario: simultáneas entre 1 y 32; peticiones por minuto entre 0 y 100000, donde 0 significa sin límite; capacidad de cola entre 1 y 1000. **Hoy estos valores se guardan; su cumplimiento durante la ejecución está pendiente.** El alcance definitivo de cuotas compartidas entre varios modelos también debe definirse.

## Experiencia del consumidor

1. Inicia sesión y abre **Proveedores**.
2. Busca por nombre, etiqueta, modelo o proveedor de origen.
3. Pulsa **Conectarse** en una oferta publicada.
4. En el chat aparece el nombre público como proveedor y la etiqueta como modelo.
5. **Desconectarse** retira esa oferta de los selectores.

La conexión es una preferencia local separada por cuenta; no es una compra ni una conexión de red a la PC. Se conserva en este dispositivo. El catálogo se refresca cada 15 segundos; una oferta pausada o eliminada deja de estar disponible en los selectores al refrescar.

En el selector del chat, el proveedor en uso permanece primero con **Seleccionado**. Los proveedores con credencial propia guardada y **Custom** se priorizan después con **Reciente**. Esa etiqueta expresa disponibilidad de configuración guardada, no una fecha de uso. Una clave de AI Gateway no convierte en guardados a todos los proveedores que dependen del gateway.

## Administración del proveedor

**Estado** muestra las ofertas propias registradas en esta PC. Los iconos permiten activar/pausar, editar y eliminar; ofertas antiguas exclusivamente locales pueden publicarse con el icono de subida. No existe todavía administración de todas las PCs desde cualquier dispositivo.

Activar significa publicar en el catálogo: **no demuestra que la PC esté encendida ni atendiendo solicitudes**. La disponibilidad real y la reconexión automática necesitan heartbeat con vencimiento. Una oferta con historial de solicitudes no puede borrarse físicamente por sus referencias; se debe pausar.

## Arquitectura actual

React presenta los paneles y Electron gestiona credenciales y almacenamiento nativo. Supabase aporta Auth y la base Postgres expuesta por Data API en el esquema `mercado`:

| Tabla | Responsabilidad |
| --- | --- |
| `perfiles` | Identidad pública vinculada a `auth.users` |
| `equipos` | PCs privadas de cada proveedor |
| `modelos` | Ofertas y configuración pública |
| `solicitudes` | Base de pedidos privados entre consumidor y proveedor |

El cliente usa URL y publishable key públicas junto con la sesión del usuario. RLS y permisos explícitos controlan el acceso. No se distribuyen contraseñas de DB ni claves administrativas. Los endpoints privados y API keys no se publican en Supabase. La sesión de escritorio se cifra mediante Windows DPAPI; las API keys permanecen en el vault nativo. En navegador, la sesión usa sessionStorage.

Para confirmar un email puede pegarse el enlace del correo dentro de Codeclub; se valida contra el proyecto configurado sin navegar al redirect de localhost. Las conexiones de Mercado se guardan por cuenta, separadas de las configuraciones que esa PC ofrece.

## Ejecución futura

La propuesta es mantener un agente proveedor en Codeclub que reciba trabajos autorizados y ejecute el modelo local o la API configurada allí. El consumidor no debe recibir la API key del proveedor ni usar su propia clave para ejecutar una oferta remota.

Queda por decidir el transporte: conexión saliente persistente y relay, o conexión directa cuando sea viable. No se necesita exponer una IP pública para publicar una oferta. La conectividad real, NAT, autenticación de equipos, streaming y cifrado del transporte todavía no están implementados. Un protocolo propio puede definir mensajes y estados, pero su confidencialidad debe apoyarse en cifrado estándar; que solo la app lo interprete no aporta por sí solo seguridad.

Flujo propuesto: consumidor autenticado → solicitud autorizada → proveedor disponible → ejecución → respuesta/stream → medición → liquidación. Hay que implementar aceptación atómica, cuotas, simultáneas, cola, cancelación, reintentos, vencimiento y recuperación tras desconexiones. La base actual crea solicitudes pendientes, pero no implementa sus transiciones ni un worker.

## Pagos futuros

El objetivo es cobrar uso y repartir proveedor/comisión. Antes de habilitarlo se deben definir precios, medición, mínimos, red/moneda, wallet, quién paga las comisiones de red, liquidación y tratamiento de solicitudes fallidas. Las confirmaciones de pago y los saldos necesitan verificación confiable; no deben depender de lo que declare el cliente local. No hay hoy contratos, wallets, depósitos, saldos ni pagos implementados.

## Estado y próximos pasos

**Implementado:** cuenta y sesión persistente, publicación online, catálogo, búsqueda, edición/pausa/borrado, conexión a selectores del chat y traducciones español/inglés.

**Pendiente:** heartbeat, transporte y ejecución remota, worker de solicitudes, streaming/cancelación, aplicación real de límites y colas, medición, precios y pagos. El chat bloquea ofertas remotas antes de consultar credenciales o enviar una petición.

Orden sugerido: (1) heartbeat y reconexión; (2) ejecución autenticada entre dos PCs sin cobros; (3) streaming y estados robustos; (4) límites/colas y medición; (5) pagos y comisión.

## Idioma y mantenimiento

El comando **/ → Idioma** cambia la interfaz entre español e inglés. Mercado, cuenta, registro, estados, etiquetas, errores y controles accesibles usan `src/lib/i18n.ts` y `useAppLanguage()`. Nombres públicos, etiquetas personalizadas, marcas e identificadores de modelos se conservan tal como los define el usuario o proveedor. Los documentos tienen versiones estáticas en ambos idiomas; no se traducen con el menú slash.

Mantener este documento y su versión inglesa alineados. Ver detalles de código, persistencia, eventos, esquema y verificaciones anteriores en [README.md](README.md). No incluir claves, tokens ni enlaces de confirmación reales en la documentación.
