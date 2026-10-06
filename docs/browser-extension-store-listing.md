# Codeclub Browser Control — Store listing draft

## English

**Name:** Codeclub Browser Control

**Short description:** Connect browser tabs to Codeclub for on-demand AI-assisted browsing.

**Category:** Productivity / Developer Tools

**Single purpose:** Connect Chromium browser tabs to the local Codeclub desktop app so its AI agent can inspect and interact with a tab when the user requests it.

**Description:**

Connect Microsoft Edge, Google Chrome, Brave, Opera, or Vivaldi to Codeclub. When you ask Codeclub to work with a browser tab, the extension returns the tab's URL, title, visible page text, and interactive controls to the Codeclub desktop app. The agent can then navigate, click, type, or scroll as requested.

The extension communicates with Codeclub on your computer over a loopback connection. It does not run a remote service, collect browsing history, or read cookies or saved browser data. Page information returned to Codeclub may be included in requests to the AI provider configured in the app. You control the extension's browser permissions and can remove it from the browser's extension manager.

## Spanish

**Nombre:** Codeclub Browser Control

**Descripción corta:** Conectá pestañas del navegador con Codeclub para navegar con IA cuando lo pidas.

**Propósito único:** Conectar pestañas Chromium con la app local de Codeclub para que su agente de IA pueda inspeccionarlas y usarlas cuando el usuario lo solicite.

**Descripción:**

Conectá Microsoft Edge, Google Chrome, Brave, Opera o Vivaldi con Codeclub. Cuando le pedís a Codeclub que trabaje con una pestaña, la extensión comparte con la app su URL, título, texto visible y controles interactivos. El agente puede navegar, hacer clic, escribir o desplazarse según tu pedido.

La extensión se comunica con Codeclub en tu computadora mediante una conexión local. No usa un servicio remoto, no recopila el historial de navegación ni lee cookies o datos guardados del navegador. La información que llega a Codeclub puede incluirse en solicitudes al proveedor de IA configurado en la app. Vos controlás los permisos y podés quitar la extensión desde el administrador del navegador.

## Permission justifications

- **debugger:** Required to inspect rendered page text and controls and perform the user-requested browser actions through the browser's debugging API.
- **tabs:** Required to list open tabs and obtain the title and URL of the tab selected by the user.
- **127.0.0.1 ports 47832–47842:** Required to connect to the Codeclub desktop app on the same computer. The app binds only to loopback and accepts the signed extension origin.

**Privacy policy URL:** Publish `docs/browser-extension-privacy.md` at a public HTTPS URL before submission.

**Support contact:** Add the publisher's support email or URL before submission.
**Store extension ID:** Confirm the store-assigned ID and add it to Codeclub's local bridge allowlist before release.
