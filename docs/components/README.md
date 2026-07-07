# Codeclub — Documentación de Componentes

Proyecto open-source. Editor/IDE con IA, hecho en Argentina.

## Stack

- **Rust** — backend nativo, comandos, filesystem.
- **Astro 7** — shell de UI y estructura frontend estática.
- **React 19** — componentes interactivos (chat).
- **Tailwind CSS** — *planeado* (actualmente todo el estilo es raw CSS en `<style>` tags).
- **Bun** — runtime JS, package manager, scripts.
- **Tauri 2** — ventana desktop, APIs nativas, puente Rust.

## Componentes

| Componente | Archivo |
|---|---|
| [Topbar](topbar.md) | `src/pages/index.astro` |
| [Sidebar](sidebar.md) | `src/pages/index.astro` |
| [Dropdown](dropdown.md) | `src/pages/index.astro` |
| [Chat](chat.md) | `src/components/ChatPanel.astro`, `src/components/ChatInterface.tsx` |

## Design Tokens

| Token | Archivo |
|---|---|
| [Colores](color-tokens.md) | Paleta completa con hex y usos |
| [Tipografía](typography.md) | Font stack, tamaños, pesos |
| [Layout](layout.md) | Grid del body, sidebar, espaciado |
| [Sombras](shadows.md) | Box shadows de cada elemento |
| [CSS Custom Properties](css-custom-properties.md) | Variables CSS del `:root` mapeadas a su uso |
