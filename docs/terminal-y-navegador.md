# Terminal y navegador

## Terminales

La terminal usa `@xterm/xterm` en el renderer, `@xterm/addon-fit` para adaptar el tamaño y `node-pty` en Electron para crear una consola interactiva real. La PTY permite prompt, cursor, historial, flechas, Ctrl+C y secuencias ANSI.

Flujo:

1. `TerminalPanel` crea la instancia xterm.
2. Electron crea una PTY de PowerShell con el cwd del proyecto.
3. `onData` de xterm envía teclas por IPC.
4. Electron acumula la salida de la PTY.
5. El panel sincroniza deltas de salida y los escribe en xterm.

Al cambiar el tamaño del panel, xterm debe recalcularse con FitAddon y la PTY debe conservar dimensiones coherentes.

## Navegador

`BrowserPanel` usa un `webview` de Electron. La toolbar controla navegación, URL, recarga, inicio, chat lateral, selección y menú. Google es la URL inicial.

El estado del navegador se publica para Computer Use con URL, título, texto y controles observables. Las acciones se ejecutan mediante selectores devueltos por ese estado.

Los errores `ERR_ABORTED (-3)` representan cancelaciones normales de navegación y no deben mostrarse como fallas cuando una navegación nueva reemplaza a la anterior.
