# Control de Windows con modelos de texto

Codeclub convierte la interfaz en un mapa JSON de elementos. El modelo elige una
referencia y una acción; Electron resuelve el destino, ejecuta y devuelve una
observación nueva. No hace falta enviar una imagen al modelo del chat.

## Implementado

- UI Automation: ventana por handle, referencias por observación, jerarquía,
  nombres, roles, texto, valores, foco, estado y patrones soportados.
- Acciones semánticas: `setValue`, `toggle`, `select`, `expand`, `collapse` y
  `scroll`. `click` prefiere InvokePattern o SelectionItemPattern.
- Teclado: `type` inserta Unicode literal (incluidos `+^%{}`); `key` usa SendKeys
  (`^a` selecciona todo, `{ENTER}` confirma). `setValue` reemplaza un campo;
  `type` inserta en el foco/selección actual.
- OCR local español/inglés en Electron, con datos incluidos en el instalador.
  Worker reutilizado, cierre tras inactividad, regiones recortables y ampliación
  2× cuando el tamaño lo permite. Lee `blocks/paragraphs/lines` de Tesseract 7;
  el código anterior buscaba `data.words`, que ya no proporciona esas cajas.
- Mapa combinado: conserva controles accesibles y agrega regiones OCR que aportan
  etiquetas adicionales. Cada región tiene fuente, confianza y referencia.
  Una región de texto no se presenta como un botón confirmado.
- Coordenadas en píxeles físicos, con origen de captura, escalado y monitores con
  coordenadas negativas. No se confunden con píxeles CSS o DIPs de Electron.
- Observaciones con vigencia de 90 segundos; cada mutación invalida las anteriores.
  Los destinos UIA se buscan otra vez dentro de su ventana y proceso. Para OCR,
  se exige que ventana y captura de la región sigan iguales antes de clicar.
- Host PowerShell persistente y oculto, solicitudes JSON por stdin, timeout,
  serialización de operaciones y cancelación desde AbortSignal o Escape del overlay.
- Resultado con `dispatched`, `verification` y `state`: el envío de un clic no se
  confunde con haber cumplido el objetivo del usuario. No hay reintentos de acciones
  automáticos que puedan duplicar envíos.
- Metadatos de auditoría sin texto escrito ni capturas. Campos marcados como
  contraseña por UIA, ancestros protegidos y edits Win32 con ES_PASSWORD se
  excluyen y enmascaran. Esto no identifica secretos arbitrarios dibujados en pantalla.

## Flujo de herramientas

1. `computerListWindows({})`: elegir `windows[].windowId`.
2. `computerAction({action:"focus", windowId:"…"})`: observar `state` devuelto.
3. Buscar el control en `state.elements`; elegir una acción disponible.
4. `computerAction({action:"setValue", snapshotId:"…", ref:"e12", text:"Hola"})`.
5. Usar el **nuevo** `state.snapshotId`. Comprobar valor/estado antes de seguir.
6. Si el control falta, `computerOcr({windowId:"…"})`; clicar su referencia y
   comprobar el foco en el nuevo estado antes de escribir.

Para interfaces grandes, `computerGetState` admite `query` y `offset`. El resultado
informa `truncated`, `nextOffset` y `textTruncated`. Un recorrido se acota a 250
elementos por respuesta, 1500 visitados, profundidad 15 y presupuesto de tiempo.
Si faltan elementos, una respuesta parcial no demuestra que no existan.

Para texto pequeño o una región que cambia, enviar a `computerOcr`:

```json
{"windowId":"…","region":{"x":100,"y":200,"width":500,"height":180}}
```

La región usa coordenadas físicas devueltas por el mapa. Si una animación o un
cursor cambia los píxeles del recorte, la acción se rechaza y hay que observar otra
vez o acotar el recorte. Las acciones UIA no dependen de igualdad de capturas.

`computerScreenshot` se conserva para solicitudes explícitas de imágenes; no se
incluye por defecto en el conjunto seleccionado para control de PC ni en el
especialista textual. El navegador integrado mantiene sus tools DOM existentes.

## Alternativa que va más allá del OCR: OmniParser

La contribución de [OmniParser de Microsoft](https://github.com/microsoft/OmniParser)
es detectar regiones interactivas y describir iconos: permite devolver, por ejemplo,
`IconCandidate: Open settings` donde un OCR solo encontraría texto o nada.
La documentación de [OmniParser V2](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/)
explica la detección y descripción funcional. El README oficial consultado el
4/9/2026 añade una novedad de julio de 2026: detector YOLOv9-E, con instrucciones
específicas para los pesos publicados en una PR. No se asume que esos pesos ya
estén descargados o que su precisión esté validada en Codeclub.

El conector está implementado. **El servidor y los pesos de OmniParser son
opcionales y no se instalaron con este cambio.** Tesseract sigue disponible sin
ellos. OmniParser sí procesa imágenes localmente; quien no necesita visión es
el modelo del chat. No equivale a prescindir de todo procesamiento visual.

Configuración:

1. Instalar OmniParser y sus pesos siguiendo el README oficial vigente. Mantener
   ese entorno Python separado del proyecto Electron.
2. Desde `OmniParser/omnitool/omniparserserver`, iniciar el servidor oficial:

   ```powershell
   python omniparserserver.py --host 127.0.0.1 --port 8000 --caption_model_name florence2 --caption_model_path ../../weights/icon_caption_florence
   ```

3. Iniciar Codeclub desde una sesión que tenga esta variable:

   ```powershell
   $env:CODECLUB_OMNIPARSER_URL = 'http://127.0.0.1:8000'
   npm run dev
   ```

4. Usar `computerOcr({windowId:"…", engine:"omniparser"})`.

El adaptador usa el contrato oficial [POST /parse/](https://github.com/microsoft/OmniParser/blob/master/omnitool/omniparserserver/omniparserserver.py):
envía `base64_image`, valida `parsed_content_list`, convierte cajas normalizadas
a píxeles físicos y descarta la imagen de salida. Solo acepta HTTP en
`127.0.0.1`; rechaza redirecciones, credenciales y hosts remotos. Su timeout es
45 segundos. Si el servicio falla, devuelve el mapa UIA y un error OCR explícito.
El modelo puede continuar con `engine:"tesseract"`.

Las descripciones de iconos son predicciones; no garantizan significado ni éxito.
La precisión de inferencia de OmniParser no se probó: sí su transporte HTTP y
validación con un servidor de ensayo.

## Verificación

```powershell
npm run electron:compile
node --test scripts/test-computer-use.mjs
npx tsx --test scripts/test-computer-tools.ts
node scripts/verify-computer-use.mjs
npm run next:build
git diff --check
```

La integración abre una ventana WPF desechable y solo interactúa con ella. Verifica
escritura por ValuePattern, InvokePattern, TogglePattern, foco, Unicode literal,
ocultación de contraseña, OCR de texto dibujado en una imagen, clic por referencia
OCR y cambio resultante. También verifica el contrato HTTP local con un stub;
no descarga ni ejecuta pesos de OmniParser. Cierra su proceso al terminar.

Los tests de tools cubren propagación de errores, cancelación y auditoría sin
texto de entrada. Los tests de motor cubren referencias consumidas/caducadas,
coordenadas negativas y validación del parser.

El build Next del proyecto omite validación de tipos. `npx tsc --noEmit` detecta
errores preexistentes en ChatInterface.tsx y Topbar.tsx, ajenos a estos cambios.
Se corrigió además una variable `maxOutputTokens` no desestructurada en run.ts,
porque producía un ReferenceError al iniciar el streaming del agente.

No se hizo una regresión manual completa de cambio de idioma, proyectos,
persistencia, redimensionado de paneles, selección del navegador y terminales.
No se cambió su UI. Tampoco se ejecutó una conversación con un proveedor real ni
se validó un instalador firmado. Los recursos nativos van en `extraResources`
para que PowerShell pueda abrir el script fuera de app.asar.

## Límites operativos

Windows debe estar desbloqueado y la aplicación objetivo en primer plano. UAC,
escritorios seguros y apps de mayor nivel de integridad pueden rechazar entrada.
Algunas apps antiguas exponen solo Panes, y canvas/juegos pueden carecer de
semántica accesible. En esos casos el OCR aporta texto; para iconos hace falta
el parser opcional u otra integración específica. No se promete control universal.

Referencia técnica: [patrones de UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview)
y [formato de salida de Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
