# Migración a Next.js + Electron

## Versión objetivo

La aplicación usa Next.js **16.3.0** fijado explícitamente. La migración debe seguir las convenciones de Next 16.3 y no introducir APIs de versiones anteriores.

## Objetivo

Dejar Codeclub como una aplicación de escritorio basada en Next.js y Electron, conservando la lógica de producto, el motor de IA y la compatibilidad con Agent Plugins y MCP.

## Decisión

No se rehace el producto desde cero. Se conserva la lógica de dominio y se reemplazan progresivamente:

- La interfaz anterior por Next.js.
- El backend nativo anterior por Electron y un proceso main en Node.js/TypeScript.
- `invoke` y eventos anteriores por IPC tipado entre renderer y main.
- La estructura visual se migra a React/Next.js.

## Arquitectura objetivo

```
Next.js Renderer
  ├── App Router
  ├── Componentes React
  ├── ChatInterface
  ├── Sidebar y paneles
  └── Cliente IPC tipado
          │
          ▼
Electron Main
  ├── Ventana principal
  ├── IPC handlers
  ├── Sistema de archivos
  ├── Terminales y procesos
  ├── BrowserView/WebContentsView
  ├── Descubrimiento de skills
  ├── Agent Plugins
  └── Runtime MCP stdio
```

## Fases

### 1. Congelar contratos

Documentar y testear los contratos de:

- Herramientas del agente.
- Eventos `codeclub:*`.
- Persistencia local.
- Agent Plugins.
- MCP stdio.
- Estado de proyectos, chats y terminales.

### 2. Crear el shell Electron

Agregar:

- `electron/main.ts`.
- `electron/preload.ts`.
- IPC seguro con `contextIsolation` y `nodeIntegration: false`.
- Ventana principal y ciclo de desarrollo/producción.
- Configuración de empaquetado.

### 3. Consolidar servicios nativos en Electron

Migrar por módulos, manteniendo la misma API conceptual:

1. Archivos y persistencia.
2. Comandos y terminales.
3. Browser automation.
4. Computer use.
5. Skills y Agent Plugins.
6. MCP stdio.
7. Menús, overlays y ventanas auxiliares.

### 4. Migrar la interfaz

Crear la aplicación Next.js y mover componentes React existentes. La prioridad es reutilizar componentes y estilos, no rediseñar durante la migración.

### 5. Validar paridad

Cada módulo debe tener:

- Pruebas unitarias.
- Prueba de IPC.
- Verificación visual.
- Prueba en Windows.
- Manejo de errores y cancelación.

### 6. Retirar restos de la migración

Eliminar archivos y referencias antiguas únicamente después de que Electron y Next.js cubran todas las capacidades.

## Reglas técnicas

- Nunca exponer Node.js directamente al renderer.
- Toda operación nativa debe pasar por IPC validado.
- Mantener tipos compartidos entre renderer y main.
- Mantener Agent Plugins y MCP como contratos independientes del framework.
- Evitar APIs específicas de Next.js dentro del proceso Electron main.
- Mantener la persistencia local compatible durante la transición.

## Riesgos

- Diferencias de seguridad entre la arquitectura anterior y Electron.
- IPC mal tipado o demasiado amplio.
- Regresiones en terminales, navegador y computer use.
- Cambios de empaquetado y actualizaciones automáticas.
- Duplicación temporal de lógica durante la migración.

## Criterio de finalización

La migración termina cuando:

- La app Electron inicia y empaqueta en Windows.
- La UI Next.js cubre las pantallas principales.
- Todas las tools del agente funcionan.
- Agent Plugins y MCP pasan las pruebas de descubrimiento y ejecución.
- La persistencia existente se conserva o migra sin pérdida.
- Los restos de la arquitectura anterior pueden eliminarse sin regresiones.
