# Migración de lógica de negocio

## Objetivo

La lógica de negocio de Codeclub debe mantenerse simple:

1. Vincular una carpeta local a la app.
2. Convertir esa carpeta en un proyecto.
3. Trabajar con el proyecto desde los chats.
4. Cambiar de proyecto en tiempo real sin reiniciar la app.

No se agregan módulos comerciales ni flujos innecesarios durante la migración.

## Concepto de proyecto

Un proyecto es una carpeta local vinculada a Codeclub.

Cada proyecto debe tener:

- Nombre visible.
- Ruta absoluta.
- Identificador estable.
- Fecha de vinculación.
- Estado activo o inactivo.
- Metadatos opcionales de UI.

La carpeta sigue siendo la fuente de verdad de sus archivos. Codeclub solo mantiene el índice y la configuración asociada.

## Vincular una carpeta

El flujo esperado es:

1. El usuario elige una carpeta.
2. La app valida que la ruta exista y sea una carpeta.
3. Codeclub crea o actualiza la entrada del proyecto.
4. El proyecto aparece en el selector.
5. La app lo deja disponible para chats, archivos, terminal y tools.

La vinculación no debe copiar ni mover archivos.

## Cambiar de proyecto

El usuario puede cambiar el proyecto activo desde la interfaz en cualquier momento.

Al cambiar:

- El chat actual recibe el nuevo `projectPath`.
- Las tools usan el nuevo proyecto desde la siguiente operación.
- El árbol de archivos se actualiza.
- La terminal nueva inicia en la carpeta seleccionada.
- El estado persistente se lee del proyecto correcto.
- La UI conserva la conversación visible salvo que el usuario elija otra.

No se deben mezclar archivos, memoria, logs ni estado entre proyectos.

## Chats y contexto

Cada chat debe conocer el proyecto activo al momento de ejecutar una acción.

El contexto mínimo es:

```ts
type ProjectContext = {
  projectId: string;
  projectPath: string;
  projectName: string;
};
```

Las herramientas no deben depender de una ruta fija ni de un estado global obsoleto. Antes de ejecutar una operación deben resolver el proyecto activo vigente.

## Persistencia

La app mantiene un índice local de proyectos:

```ts
type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt?: string;
};
```

El índice puede vivir en la configuración de la app. Los datos específicos del proyecto deben permanecer asociados a su `projectId` o ruta normalizada.

## Electron

Electron debe exponer al renderer únicamente operaciones tipadas:

- Seleccionar carpeta.
- Vincular proyecto.
- Listar proyectos.
- Activar proyecto.
- Desvincular proyecto.
- Leer el proyecto activo.

El proceso main valida rutas y ejecuta operaciones nativas. Next.js administra la selección y el estado de la interfaz.

## Contratos mínimos

### Eventos

- `project:list-updated`
- `project:activated`
- `project:removed`
- `workspace:changed`

### Acciones

- `selectProjectFolder`
- `addProject`
- `switchProject`
- `removeProject`
- `getActiveProject`

## Reglas

- Una ruta física no debe aparecer duplicada.
- Las rutas deben normalizarse antes de compararse.
- Cambiar de proyecto no debe reiniciar el proceso Electron.
- Un proyecto eliminado del índice no se borra del disco.
- Si la carpeta deja de existir, el proyecto se marca como no disponible.
- Las tools deben fallar claramente si no hay proyecto activo.
- El usuario siempre debe poder ver qué proyecto está activo.

## Criterios de aceptación

La migración cumple cuando:

- Se puede vincular una carpeta existente.
- El proyecto aparece inmediatamente en la app.
- Se puede cambiar de proyecto mientras un chat está abierto.
- Las operaciones siguientes apuntan al proyecto correcto.
- No hay contaminación entre archivos, estado o logs.
- Desvincular un proyecto no elimina sus archivos.
- Next.js y Electron mantienen este comportamiento sin lógica duplicada.

