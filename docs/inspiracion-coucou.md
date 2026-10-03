# Coucou: ideas para el widget y el ADE de Codeclub

Revisión del repositorio público y del código de Windows realizada el 3 de octubre de 2026. Son recomendaciones, sin implementar cambios en la aplicación.

Lo más interesante es su manejo de la atención: muestra qué está pasando, pide intervención cuando hace falta y permite volver al trabajo. Codeclub ya tiene chat flotante, orbe, arrastre, proveedores, herramientas y aprobaciones; el siguiente salto sería conectar esas capacidades en una experiencia coherente.

## Qué tomar para el widget

| Prioridad | Idea comprobada en Coucou | Adaptación propuesta a Codeclub | Esfuerzo relativo |
| --- | --- | --- | --- |
| 1 | Estados explícitos de oculto, compacto y expandido, con alertas que quedan fijadas. | Mantener el input compacto que elegiste; añadir retracción opcional al borde y expansión por acción del usuario. Nunca contraer mientras se escribe o hay una pregunta pendiente. | Medio |
| 1 | El indicador distingue pensamiento, herramientas, preguntas, error y finalización. | Darle significado al orbe: pulso azul mientras trabaja, pausa reconocible cuando necesita respuesta y señal breve al finalizar. Una línea como «Editando ChatInterface.tsx» explica la actividad sin abrir el chat. | Medio |
| 1 | Una aprobación identifica la acción y su destino; las solicitudes tienen identidad y vencimiento. | Mostrar las aprobaciones que ya tenemos en el widget: acción, archivo o comando, Permitir y Rechazar. Una cola evita reemplazar una solicitud todavía pendiente; al expirar se retira. | Medio |
| 1 | La ventana de Windows evita activarse por defecto y habilita interacción cuando corresponde. | Que una notificación no interrumpa la escritura en otra app. Activar el teclado al hacer clic en el input y dejar pasar clics por las zonas transparentes. | Medio |
| 2 | Arrastrar un archivo activa una secuencia visual dedicada. | Resaltar el borde azul, mostrar nombre/tipo del archivo y confirmar que se adjuntó. El orbe puede acompañar con un pulso breve. El progreso debe reflejar lectura o procesamiento real. | Bajo/medio |

Fuentes: [máquina de estados](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/fsm.ts), [actividad y aprobaciones](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/hooks.ts), [foco de Windows](https://github.com/Louis-CFM/coucou/blob/main/windows/src-tauri/src/platform/windows.rs), [secuencia de archivos](https://github.com/Louis-CFM/coucou/blob/main/windows/src/upload/sequence.ts).

El orbe conservaría nuestra identidad azul. Los ejemplos de pulso y estados son propuestas propias; Coucou los representa mediante su personaje y sus indicadores.

## Qué tomar para el ADE

**1. Un centro de actividad de todos los chats.** Coucou convierte eventos de agentes en indicadores y pasos legibles. Propondría mostrar proyecto, chat, acción actual y estado, con acceso directo al chat que necesita atención. Reutilizaríamos `codeclub:agent-activity`, los runtimes y los eventos de herramientas existentes. Primero nuestros agentes; los externos podrían añadirse después. [Eventos y ciclo de sesiones](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/hooks.ts).

**2. Un motor de sesión compartido entre ADE y widget.** En Coucou, la interfaz recibe actividad a través de un puente nativo. En Codeclub, hoy cada ChatInterface mantiene sus runtimes en su renderer. Recomiendo centralizar la ejecución y distribuir su estado para ver la misma tarea desde ambas ventanas, responder a la misma aprobación y retomar el mismo chat al abrir la app. Es una adaptación arquitectónica nuestra, no una función de ADE que Coucou ya tenga. [Puente de agentes de Coucou](https://github.com/Louis-CFM/coucou/blob/main/docs/AGENTS.md); código local: `src/components/ChatInterface.tsx` y `src/components/FloatingChat.tsx`.

**3. Credenciales administradas por Electron.** Coucou usa el almacén del sistema y ofrece una consulta de presencia. Nosotros pasamos credenciales por `setSetting`, que persiste settings en archivo y localStorage. Tomaría la separación: la interfaz solicita guardar, reemplazar o comprobar una credencial; Electron la recupera para la petición. Esto necesita adaptar también el transporte de proveedores y Vercel Gateway. [Implementación de secretos](https://github.com/Louis-CFM/coucou/blob/main/windows/src-tauri/src/secrets.rs); código local: `src/lib/persistence.ts` y `saveCredential` en `ChatInterface.tsx`.

**4. Integraciones que comuniquen resultados concretos.** Coucou consulta GitHub, Vercel y otros servicios y emite actualizaciones cuando cambian. En nuestro ADE priorizaría «build falló», «deploy listo» y «PR requiere atención», con un enlace al recurso. Los eventos comunes pueden mostrarse como un indicador; expandir el widget debería quedar reservado a lo que requiere una respuesta. Vercel deployments y Vercel AI Gateway son integraciones diferentes, con credenciales y finalidades diferentes. [Pollers de integraciones](https://github.com/Louis-CFM/coucou/blob/main/windows/src-tauri/src/integrations.rs).

**5. Integración opcional con agentes externos.** Su relay recibe eventos por named pipe en Windows y los traduce a estados comunes. La instalación de hooks presenta un diff y un respaldo; si la app no responde, el agente continúa por su canal habitual. Podríamos aplicar ese patrón a herramientas externas que el usuario ya use. Lo dejaría para una segunda etapa: nuestra ejecución propia debe quedar bien integrada primero. [Windows y hooks](https://github.com/Louis-CFM/coucou/blob/main/windows/README.md), [protocolo de agentes](https://github.com/Louis-CFM/coucou/blob/main/docs/AGENTS.md).

## Lo más útil para el acabado visual

Su máquina de estados está separada del DOM y de Tauri. Es una buena referencia para definir qué transición puede empezar, cuál debe terminar y cuándo una alerta tiene prioridad. En Codeclub conviene extender esa disciplina a apertura, cierre, adjuntos y cambios de conversación. [FSM](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/fsm.ts).

Sus helpers distinguen crecimiento mediante spring y reducción mediante una curva temporal sin sobrepaso. Tomaría esa consistencia, adaptando el movimiento a nuestra preferencia: mensajes y scroll estables; cambios de superficie breves y suaves. No conviene copiar sus springs literalmente porque algunos tienen rebote deliberado. [Helpers de animación](https://github.com/Louis-CFM/coucou/blob/main/windows/src/core/anim.ts).

También detiene secuencias visuales al salir de su vista y el loop de dibujo cuando queda oculto. Para nosotros significa pausar el orbe invisible y el trabajo puramente visual, mientras la ejecución de la IA sigue independiente. Sus integraciones tienen una pausa explícita de red. [Control de la isla](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/island.ts), [integraciones](https://github.com/Louis-CFM/coucou/blob/main/windows/src-tauri/src/integrations.rs).

## Orden recomendado

1. Motor de sesión y estado compartidos: una tarea visible y controlable desde ADE y widget.
2. Orbe con estados útiles y aprobaciones compactas, sin robar foco.
3. Estados de apertura/cierre y feedback de adjuntos coordinados.
4. Almacenamiento nativo de credenciales, en paralelo al trabajo visual.
5. Notificaciones de GitHub/Vercel y, después, agentes externos.

Ya tenemos buena parte de las piezas. La mejora principal sería conectarlas y mostrar menos información, pero más útil, en cada momento.

## Alcance de la revisión y reutilización

Revisé fuentes y documentación; no ejecuté Coucou. Hay diferencias de funciones entre macOS y Windows. Además, la presentación general menciona varios agentes, pero el handler Windows revisado devuelve las aprobaciones de agentes externos al terminal; no hay que asumir que todas esas aprobaciones ya funcionan en la isla. [Handler real](https://github.com/Louis-CFM/coucou/blob/main/windows/src/island/hooks.ts).

Su código está bajo MIT, con conservación del aviso correspondiente si reutilizamos código. La marca, el personaje, los sonidos y otros recursos tienen una licencia separada. Las recomendaciones usan nuestro orbe y nuestra identidad. [Licencia del código](https://github.com/Louis-CFM/coucou/blob/main/LICENSE), [licencia de recursos](https://github.com/Louis-CFM/coucou/blob/main/LICENSE-ASSETS.md).
