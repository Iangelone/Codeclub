# Terminal y navegador

## Terminales

La terminal visual usa `@xterm/xterm`. Electron crea una PTY real con `node-pty` y mantiene la sesión nativa.

```text
xterm -> onData -> IPC -> node-pty
node-pty -> salida -> IPC -> xterm
```

Incluye:

- PowerShell con el proyecto como directorio de trabajo;
- escritura de teclas, historial, flechas y Ctrl+C;
- salida ANSI y scroll;
- ajuste visual con `@xterm/addon-fit`;
- cleanup al cerrar la pestaña.

## Navegador

`BrowserPanel` usa un `webview` de Electron. La toolbar tiene:

- atrás y adelante;
- recarga y página inicial;
- barra de dirección;
- selección de elementos;
- menú para recargar o abrir fuera de Codeclub.

## Selección DOM y comentarios

1. Activar **Seleccionar**.
2. Hacer clic en un elemento visible.
3. Escribir un comentario opcional.
4. Confirmar con Enter.
5. La página recibe una burbuja numerada.
6. La tarjeta aparece como referencia del chat.

La referencia contiene el HTML sanitizado, texto visible, URL y comentario. No debe mandar credenciales ni secretos de la página.

## Computer Use

El navegador publica estado observable: URL, título, texto y controles visibles. Las acciones usan selectores generados por ese estado.

```text
browser-state -> modelo / Computer Use
browser-action <- click | type | key | scroll
```

`ERR_ABORTED (-3)` se considera una cancelación normal cuando una navegación reemplaza a otra.

## Seguridad

- No ejecutar JavaScript arbitrario desde el renderer fuera de los flujos controlados.
- Sanitizar referencias antes de agregarlas al prompt.
- No mostrar API keys o cookies en el chat.
- Mantener foco, labels y cleanup de listeners.
