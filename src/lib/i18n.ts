import { useEffect, useState } from 'react';

export type AppLanguage = 'es' | 'en';

export const LANGUAGE_STORAGE_KEY = 'codeclub-language';

export function useAppLanguage(): AppLanguage {
  const [language, setLanguage] = useState<AppLanguage>('es');
  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'es') setLanguage(stored);
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (next === 'en' || next === 'es') setLanguage(next);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    document.documentElement.lang = stored === 'en' ? 'en' : 'es';
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return language;
}

export const topbarTranslations = {
  es: {
    toggleSidebar: 'Alternar barra lateral',
    back: 'Atrás',
    forward: 'Adelante',
    applicationMenu: 'Menú de aplicación',
    file: 'Archivo',
    newChat: 'Nuevo chat',
    projects: 'Proyectos',
    agents: 'Agentes',
    extensions: 'Complementos',
    recentChats: 'Últimos chats',
    view: 'Ver',
    sidePanel: 'Panel lateral',
    fullscreen: 'Pantalla completa',
    appearance: 'Apariencia',
    help: 'Ayuda',
    documentation: 'Documentación',
    shortcuts: 'Atajos',
    reportProblem: 'Reportar problema',
    donation: 'Donación',
    developer: 'Desarrollador',
    inspectWorkspace: '1. Inspeccionar el workspace',
    createPlan: '3. Crear y verificar un plan',
    editFile: '4. Editar y comprobar un archivo',
    testBrowser: '5. Probar el navegador',
    diagnostics: '6. Diagnóstico completo',
    recoverError: '7. Recuperar un error',
    testComputerUse: '8. Probar control de PC',
    assistantComputerTest: 'Saludar a ChatGPT',
    assistantBrowserCursorTest: 'Probar cursor del navegador',
    assistantComputerCursorTest: 'Probar cursor de la PC',
    assistantComputerOverlay: 'Activar overlay de Computer Use',
    assistantComputerOverlayActive: 'Desactivar overlay de Computer Use',
    assistant: 'Asistente',
    workspaceControls: 'Controles del workspace',
    simplePanel: 'Panel simple',
    splitPanel: 'Panel doble',
    showDock: 'Mostrar dock',
    windowControls: 'Controles de ventana',
    minimize: 'Minimizar',
    maximize: 'Maximizar',
    close: 'Cerrar',
    home: 'Inicio',
    addProject: 'Agregar proyecto o vincular carpeta',
    linkFolder: 'Vincular carpeta como proyecto',
    hideTopbar: 'Ocultar barra superior',
    showTopbar: 'Mostrar barra superior',
    hideLeftSidebar: 'Ocultar barra lateral izquierda',
    showLeftSidebar: 'Mostrar barra lateral izquierda',
    hideRightSidebar: 'Ocultar barra lateral derecha',
    showRightSidebar: 'Mostrar barra lateral derecha',
    projectTab: 'Pestañas de proyectos',
    panels: 'Paneles',
  },
  en: {
    toggleSidebar: 'Toggle sidebar',
    back: 'Back',
    forward: 'Forward',
    applicationMenu: 'Application menu',
    file: 'File',
    newChat: 'New chat',
    projects: 'Projects',
    agents: 'Agents',
    extensions: 'Extensions',
    recentChats: 'Recent chats',
    view: 'View',
    sidePanel: 'Side panel',
    fullscreen: 'Fullscreen',
    appearance: 'Appearance',
    help: 'Help',
    documentation: 'Documentation',
    shortcuts: 'Shortcuts',
    reportProblem: 'Report a problem',
    donation: 'Donation',
    developer: 'Developer',
    inspectWorkspace: '1. Inspect workspace',
    createPlan: '3. Create and verify a plan',
    editFile: '4. Edit and check a file',
    testBrowser: '5. Test browser',
    diagnostics: '6. Full diagnostics',
    recoverError: '7. Recover from an error',
    testComputerUse: '8. Test computer control',
    assistantComputerTest: 'Greet ChatGPT',
    assistantBrowserCursorTest: 'Test browser cursor',
    assistantComputerCursorTest: 'Test PC cursor',
    assistantComputerOverlay: 'Activate Computer Use overlay',
    assistantComputerOverlayActive: 'Deactivate Computer Use overlay',
    assistant: 'Assistant',
    workspaceControls: 'Workspace controls',
    simplePanel: 'Single panel',
    splitPanel: 'Split panel',
    showDock: 'Show dock',
    windowControls: 'Window controls',
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
    home: 'Home',
    addProject: 'Add project or link folder',
    linkFolder: 'Link folder as project',
    hideTopbar: 'Hide top bar',
    showTopbar: 'Show top bar',
    hideLeftSidebar: 'Hide left sidebar',
    showLeftSidebar: 'Show left sidebar',
    hideRightSidebar: 'Hide right sidebar',
    showRightSidebar: 'Show right sidebar',
    projectTab: 'Project tabs',
    panels: 'Panels',
  },
} as const;

export const sidebarTranslations = {
  es: {
    chat: 'Chat', projects: 'Proyectos', agents: 'Agentes', extensions: 'Extensiones', chats: 'Chats', settings: 'Ajustes', tasks: 'Tareas', devices: 'Dispositivos', recent: 'Recientes', support: 'Apoyar Codeclub',
    projectName: 'Nombre del proyecto', newFile: 'Nuevo archivo', newFolder: 'Nueva carpeta', ready: 'Listo para revisión',
    couldNotCreate: 'No se pudo crear', newChat: 'Nuevo chat', createNew: 'Crear nuevo...', open: 'Abrir', close: 'Cerrar', rename: 'Renombrar', delete: 'Eliminar', clearChats: 'Limpiar chats', clearProjectChats: 'Limpiar todos los chats de este proyecto', newName: 'Nuevo nombre', deleteElement: 'Eliminar elemento', selectFolder: 'Seleccionar carpeta para el proyecto',
  },
  en: {
    chat: 'Chat', projects: 'Projects', agents: 'Agents', extensions: 'Extensions', chats: 'Chats', settings: 'Settings', tasks: 'Tasks', devices: 'Devices', recent: 'Recent', support: 'Support Codeclub',
    projectName: 'Project name', newFile: 'New file', newFolder: 'New folder', ready: 'Ready for review',
    couldNotCreate: 'Could not create', newChat: 'New chat', createNew: 'Create new...', open: 'Open', close: 'Close', rename: 'Rename', delete: 'Delete', clearChats: 'Clear chats', clearProjectChats: 'Clear all chats from this project', newName: 'New name', deleteElement: 'Delete item', selectFolder: 'Select folder for project',
  },
} as const;

export const rightSidebarTranslations = {
  es: { files: 'Archivos', review: 'Revisar', browser: 'Navegador', artifacts: 'Artifacts', terminals: 'Terminales', home: 'Inicio', newTab: 'Nueva pestaña', rightPanel: 'Panel lateral derecho', resizePanel: 'Redimensionar panel derecho', toggleTree: 'Mostrar u ocultar árbol del workspace', loadingFile: 'Cargando archivo...', openFile: 'Abrir archivo', selectFile: 'Selecciona un archivo del árbol del espacio de trabajo', filterFiles: 'Filtrar archivos...', loadingFiles: 'Cargando archivos...', noFiles: 'No se encontraron archivos.', changes: 'Cambios', file: 'archivo', filesCount: 'archivos', toggleFiles: 'Mostrar u ocultar archivos', refreshChanges: 'Actualizar cambios', reviewing: 'Revisando cambios...', noPendingChanges: 'Sin cambios pendientes.', noDiff: 'No hay diff disponible para este archivo.', selectProjectReview: 'Seleccioná un proyecto para revisar sus cambios.', untracked: 'Sin seguimiento', deleted: 'Eliminado', renamed: 'Renombrado', added: 'Añadido', modified: 'Modificado', artifactsDescription: 'Elementos generados y utilizados por la IA.', plan: 'Plan', todo: 'TODO', deletePlan: 'Eliminar plan', deleteTodo: 'Eliminar TODO', noTodosPlans: 'Todavía no hay TODOs ni planes.', selectProjectArtifacts: 'Seleccioná un proyecto para ver sus artifacts.', pending: 'Pendiente', inProgress: 'En curso', completed: 'Completado', cancelled: 'Cancelado', blocked: 'Bloqueado', back: 'Atrás', forward: 'Adelante', reload: 'Recargar', selectElement: 'Seleccionar elemento', webAddress: 'Dirección web', referencePage: 'Referenciar página', moreOptions: 'Más opciones', invalidUrl: 'URL inválida. Revisá el dominio o el puerto.', pageAddress: 'Escribí una dirección para navegar', selectedElement: 'Elemento seleccionado', page: 'Página', openPage: 'Página abierta', newTerminal: 'Nueva terminal', createTerminal: 'Crear terminal', hideTerminal: 'Ocultar terminal', activateTerminal: 'Activar', closeTerminal: 'Cerrar terminal', closeTab: 'Cerrar pestaña', closeOtherTabs: 'Cerrar otras pestañas', closeTabsToRight: 'Cerrar pestañas a la derecha' },
  en: { files: 'Files', review: 'Review', browser: 'Browser', artifacts: 'Artifacts', terminals: 'Terminals', home: 'Home', newTab: 'New tab', rightPanel: 'Right sidebar', resizePanel: 'Resize right sidebar', toggleTree: 'Show or hide workspace tree', loadingFile: 'Loading file...', openFile: 'Open file', selectFile: 'Select a file from the workspace tree', filterFiles: 'Filter files...', loadingFiles: 'Loading files...', noFiles: 'No files found.', changes: 'Changes', file: 'file', filesCount: 'files', toggleFiles: 'Show or hide files', refreshChanges: 'Refresh changes', reviewing: 'Reviewing changes...', noPendingChanges: 'No pending changes.', noDiff: 'No diff available for this file.', selectProjectReview: 'Select a project to review its changes.', untracked: 'Untracked', deleted: 'Deleted', renamed: 'Renamed', added: 'Added', modified: 'Modified', artifactsDescription: 'Elements generated and used by AI.', plan: 'Plan', todo: 'TODO', deletePlan: 'Delete plan', deleteTodo: 'Delete TODO', noTodosPlans: 'There are no TODOs or plans yet.', selectProjectArtifacts: 'Select a project to view its artifacts.', pending: 'Pending', inProgress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', blocked: 'Blocked', back: 'Back', forward: 'Forward', reload: 'Reload', selectElement: 'Select element', webAddress: 'Web address', referencePage: 'Reference page', moreOptions: 'More options', invalidUrl: 'Invalid URL. Check the domain or port.', pageAddress: 'Enter an address to browse', selectedElement: 'Selected element', page: 'Page', openPage: 'Open page', newTerminal: 'New terminal', createTerminal: 'Create terminal', hideTerminal: 'Hide terminal', activateTerminal: 'Activate', closeTab: 'Close tab', closeOtherTabs: 'Close other tabs', closeTabsToRight: 'Close tabs to the right' },
} as const;

export const browserUiTranslations = {
  es: {
    selectionReady: 'Selecci\u00f3n lista para referenciar',
    elementReady: 'Elemento listo para referenciar',
    add: 'Agregar',
    removeSelection: 'Quitar selecci\u00f3n',
    loading: 'Cargando...',
    empty: 'Escrib\u00ed una direcci\u00f3n para navegar',
    pageError: 'No se pudo cargar la p\u00e1gina',
  },
  en: {
    selectionReady: 'Selection ready to reference',
    elementReady: 'Element ready to reference',
    add: 'Add',
    removeSelection: 'Remove selection',
    loading: 'Loading...',
    empty: 'Enter an address to browse',
    pageError: 'Could not load page',
  },
} as const;
