/** Shared UI language catalog; language-change events synchronize mounted renderer windows. */
import { useEffect, useState } from 'react';

export type AppLanguage = 'es' | 'en';

export const LANGUAGE_STORAGE_KEY = 'codeclub-language';
export const toolConsoleTranslations = {
  es: { title: 'Consola de herramienta', input: 'Entrada', output: 'Salida', running: 'En curso', failed: 'Falló', done: 'Listo', waiting: 'Esperando el resultado…', empty: 'Sin salida', truncated: 'Salida recortada para mostrarla' },
  en: { title: 'Tool console', input: 'Input', output: 'Output', running: 'Running', failed: 'Failed', done: 'Done', waiting: 'Waiting for the result…', empty: 'No output', truncated: 'Output truncated for display' },
} as const;
export const browserExtensionTranslations = {
  es: { edgeInstall: 'En Edge, elegí «Obtener» y aceptá agregar Codeclub Browser Control.', manualInstall: 'Elegí «Cargar descomprimida» y seleccioná la carpeta Codeclub Browser Control que se abrió.', uninstall: 'Quitá Codeclub Browser Control desde la página de extensiones del navegador.', help: 'Edge: Instalar abre Microsoft Edge Add-ons. Desinstalar abre la extensión para quitarla. Otros navegadores usan carga manual. Conectado confirma que la extensión responde a Codeclub.' },
  en: { edgeInstall: 'In Edge, choose Get and approve adding Codeclub Browser Control.', manualInstall: 'Choose Load unpacked and select the Codeclub Browser Control folder that opened.', uninstall: 'Remove Codeclub Browser Control from the browser extensions page.', help: 'Edge: Install opens Microsoft Edge Add-ons. Uninstall opens the extension for removal. Other browsers use manual loading. Connected confirms the companion responds to Codeclub.' },
} as const;
export const extensionActionTranslations = {
  es: { install: 'Instalar', uninstall: 'Desinstalar' },
  en: { install: 'Install', uninstall: 'Uninstall' },
} as const;
export const activityTranslations = {
  es:{paymentRequired:'El proveedor requiere un método de pago registrado para habilitar las solicitudes, incluso con modelos gratuitos.',subscriptionRequired:'Este proveedor requiere una suscripción activa para usar el modelo.',clientRestricted:'El proveedor limita este modelo gratuito a su propia aplicación. Elegí otro proveedor o modelo.',attachmentFailed:'No se pudo preparar una vista previa. Verificá el archivo antes de enviar.',question:'Espera tu respuesta',externalAgents:'Agentes externos',externalNote:'Las aprobaciones externas siguen en el terminal.',previewHooks:'Ver cambios de hooks de Claude Code',installHooks:'Instalar con respaldo',title:'Actividad',approval:'Necesita tu permiso',thinking:'Pensando',working:'Trabajando',finished:'Terminado',cancelled:'Cancelado',error:'Requiere atención',idle:'Listo',integrations:'Integraciones',repository:'Repositorio',username:'Usuario para revisiones',project:'Proyecto',team:'Equipo opcional',keepCredential:'Conservar credencial actual',pause:'Pausar consultas',failed:'No se pudo guardar.',saving:'Guardando…',save:'Guardar',empty:'No hay actividad pendiente.',global:'Sin proyecto',open:'Abrir',allow:'Permitir',deny:'Rechazar',cancel:'Cancelar',autoHide:'Ocultar automáticamente',keepOpen:'Mantener visible',attached:'Archivo adjunto',attaching:'Preparando archivo…'},
  en:{paymentRequired:'The provider requires a payment method on file to enable requests, including free models.',subscriptionRequired:'This provider requires an active subscription to use the model.',clientRestricted:'The provider restricts this free model to its own application. Choose another provider or model.',attachmentFailed:'A preview could not be prepared. Check the file before sending.',question:'Waiting for your reply',externalAgents:'External agents',externalNote:'External approvals stay in the terminal.',previewHooks:'Preview Claude Code hook changes',installHooks:'Install with backup',title:'Activity',approval:'Needs your permission',thinking:'Thinking',working:'Working',finished:'Finished',cancelled:'Cancelled',error:'Needs attention',idle:'Ready',integrations:'Integrations',repository:'Repository',username:'User for reviews',project:'Project',team:'Optional team',keepCredential:'Keep current credential',pause:'Pause polling',failed:'Could not save.',saving:'Saving…',save:'Save',empty:'No pending activity.',global:'No project',open:'Open',allow:'Allow',deny:'Deny',cancel:'Cancel',autoHide:'Auto hide',keepOpen:'Keep visible',attached:'File attached',attaching:'Preparing file…'},
};

export const chatHistoryTranslations = {
  es: { conflict:'El historial cambió en otra ventana. Reabrí este chat antes de reintentar.', loading:'Cargando mensajes…', failed:'No se pudo cargar el historial.', retry:'Reintentar', latest:'Ir a los últimos mensajes', tooLarge:'El mensaje o los archivos superan el contexto disponible. Reducí su tamaño o usá referencias a archivos.' },
  en: { conflict:'History changed elsewhere. Reopen this chat before retrying.', loading:'Loading messages…', failed:'Could not load history.', retry:'Retry', latest:'Go to latest messages', tooLarge:'The message or files exceed the available context. Reduce their size or use file references.' },
};

export const aiCredentialTranslations = {
  es: { enter: 'Escribí tu credencial de' },
  en: { enter: 'Enter your credential for' },
};

export const providerErrorTranslations = {
  es: { temporarilyUnavailable: 'El proveedor no está disponible temporalmente. Esperá un momento o elegí otro modelo.' },
  en: { temporarilyUnavailable: 'The provider is temporarily unavailable. Wait a moment or choose another model.' },
};

export const floatingChatTranslations = {
  es: { chat: 'Chat flotante', controls: 'Controles del chat', open: 'Abrir Codeclub', newChat: 'Nuevo chat', collapse: 'Contraer chat', close: 'Cerrar widget', openAttention: 'Abrir pendiente', noAttention: 'Sin pendientes', drag: 'Arrastrar arriba o abajo de la pantalla' },
  en: { chat: 'Floating chat', controls: 'Chat controls', open: 'Open Codeclub', newChat: 'New chat', collapse: 'Collapse chat', close: 'Close widget', openAttention: 'Open pending item', noAttention: 'No pending items', drag: 'Drag to the top or bottom of the screen' },
};

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
    open: 'Abrir',
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
    minimizeWindow: 'Minimizar ventana',
    maximizeWindow: 'Maximizar o restaurar ventana',
    hideInTray: 'Ocultar aplicación en la bandeja',
    openCommands: 'Abrir comandos del chat',
    closeCommands: 'Cerrar comandos del chat',
  },
  en: {
    toggleSidebar: 'Toggle sidebar',
    back: 'Back',
    forward: 'Forward',
    applicationMenu: 'Application menu',
    file: 'File',
    newChat: 'New chat',
    projects: 'Projects',
    open: 'Open',
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
    minimizeWindow: 'Minimize window',
    maximizeWindow: 'Maximize or restore window',
    hideInTray: 'Hide application to tray',
    openCommands: 'Open chat commands',
    closeCommands: 'Close chat commands',
  },
} as const;

export const chatActionTranslations = {
  es: { copy: 'Copiar mensaje', copied: 'Mensaje copiado', more: 'Más opciones de la respuesta', regenerate: 'Regenerar respuesta', trace: 'Copiar trazabilidad completa' },
  en: { copy: 'Copy message', copied: 'Message copied', more: 'More response options', regenerate: 'Regenerate response', trace: 'Copy full chat trace' },
} as const;

export const browserStyleTranslations = {
  es: { edit: 'Editar elemento', pickColor: 'Elegir color', description: 'Describe estos cambios...', content: 'Texto', color: 'Color del texto', background: 'Fondo', opacity: 'Opacidad', fontFamily: 'Fuente', fontSize: 'Tamaño de fuente', fontWeight: 'Grosor de fuente', borderRadius: 'Radio del borde', borderColor: 'Color del borde', borderWidth: 'Ancho del borde', width: 'Ancho', height: 'Altura', padding: 'Relleno', margin: 'Margen', sides: ['Arriba', 'Derecha', 'Abajo', 'Izquierda'], cancel: 'Cancelar', confirm: 'Añadir cambios al chat', invalidValue: 'Valor CSS inválido', previewUnavailable: 'El elemento ya no está disponible. Volvé a seleccionarlo.', changesTitle: 'Cambios de estilo' },
  en: { edit: 'Edit element', pickColor: 'Choose color', description: 'Describe these changes...', content: 'Text', color: 'Text color', background: 'Background', opacity: 'Opacity', fontFamily: 'Font', fontSize: 'Font size', fontWeight: 'Font weight', borderRadius: 'Border radius', borderColor: 'Border color', borderWidth: 'Border width', width: 'Width', height: 'Height', padding: 'Padding', margin: 'Margin', sides: ['Top', 'Right', 'Bottom', 'Left'], cancel: 'Cancel', confirm: 'Add changes to chat', invalidValue: 'Invalid CSS value', previewUnavailable: 'The element is no longer available. Select it again.', changesTitle: 'Style changes' },
} as const;

export const agentTextSelectionTranslations = {
  es: { addToChat: 'Añadir al chat', addComment: 'Añadir comentario', commentPlaceholder: 'Añade un comentario opcional…', moreDetails: 'Más detalles', toolbar: 'Acciones para el texto seleccionado', detailPrompt: 'Explicame con más detalle esta parte:', selectedReference: 'Texto seleccionado', removeReference: 'Quitar referencia' },
  en: { addToChat: 'Add to chat', addComment: 'Add a comment', commentPlaceholder: 'Add an optional comment…', moreDetails: 'More details', toolbar: 'Actions for selected text', detailPrompt: 'Explain this part in more detail:', selectedReference: 'Selected text', removeReference: 'Remove reference' },
} as const;

export const sidebarTranslations = {
  es: {
    chat: 'Chat', projects: 'Proyectos', agents: 'Agentes', extensions: 'Extensiones', chats: 'Chats', settings: 'Ajustes', orbs: 'Orbes', devices: 'Varios', recent: 'Recientes', support: 'Apoyar Codeclub',
    projectName: 'Nombre del proyecto', renameProject: 'Cambiar nombre del proyecto', saveProjectName: 'Guardar nombre del proyecto', renameProjectError: 'No se pudo cambiar el nombre del proyecto.', newFile: 'Nuevo archivo', newFolder: 'Nueva carpeta', ready: 'Listo para revisión', workspace: 'Espacio de trabajo', leftSidebar: 'Barra lateral izquierda', mainNavigation: 'Navegación principal', chatMenu: 'Menú del chat', donation: 'Hacer una donación',
    couldNotCreate: 'No se pudo crear', newChat: 'Nuevo chat', createNew: 'Crear nuevo...', open: 'Abrir', close: 'Cerrar', rename: 'Renombrar', delete: 'Eliminar', clearChats: 'Limpiar chats', clearHistory: 'Limpiar historial', clearProjectChats: 'Limpiar todos los chats de este proyecto', newName: 'Nuevo nombre', deleteElement: 'Eliminar elemento', selectFolder: 'Seleccionar carpeta para el proyecto',
  },
  en: {
    chat: 'Chat', projects: 'Projects', agents: 'Agents', extensions: 'Extensions', chats: 'Chats', settings: 'Settings', orbs: 'Orbs', devices: 'Miscellaneous', recent: 'Recent', support: 'Support Codeclub',
    projectName: 'Project name', renameProject: 'Rename project', saveProjectName: 'Save project name', renameProjectError: 'Could not rename the project.', newFile: 'New file', newFolder: 'New folder', ready: 'Ready for review', workspace: 'Workspace', leftSidebar: 'Left sidebar', mainNavigation: 'Main navigation', chatMenu: 'Chat menu', donation: 'Make a donation',
    couldNotCreate: 'Could not create', newChat: 'New chat', createNew: 'Create new...', open: 'Open', close: 'Close', rename: 'Rename', delete: 'Delete', clearChats: 'Clear chats', clearHistory: 'Clear history', clearProjectChats: 'Clear all chats from this project', newName: 'New name', deleteElement: 'Delete item', selectFolder: 'Select folder for project',
  },
} as const;

export const orbControlTranslations = {
  es: { initiatedChat: 'Inició esta conversación', verifying: 'Verificando el resultado…', blocked: 'Bloqueado · revisá el chat', unverified: 'Sin verificar · revisá el chat', openChat: 'Abrir chat del orbe', queued: 'En cola…', connecting: 'Conectando con el modelo…', thinking: 'Pensando el próximo paso…', working: 'Ejecutando una herramienta…', waiting: 'Esperando el próximo ciclo', failed: 'El último ciclo falló · revisá la trazabilidad', interrupted: 'La última ejecución se interrumpió', tools: { externalBrowserList: 'Buscando navegadores conectados…', externalBrowserState: 'Leyendo la pestaña…', externalBrowserAction: 'Interactuando con la pestaña…', openBrowser: 'Abriendo una página…', getBrowserState: 'Revisando la página…', browserAction: 'Interactuando con la página…', readFile: 'Leyendo archivos…', searchText: 'Buscando en el proyecto…', listFiles: 'Explorando archivos…', runCommand: 'Ejecutando un comando…' }, delete: 'Borrar orbe', stopBeforeDelete: 'Detené el orbe antes de borrarlo', play: 'Iniciar orbe', stop: 'Detener orbe', copyTrace: 'Copiar trazabilidad', copied: 'Trazabilidad copiada', off: 'Apagado', active: 'Activo', actionError: 'No se pudo completar la acción del orbe.' },
  en: { initiatedChat: 'Started this conversation', verifying: 'Verifying the result…', blocked: 'Blocked · check the chat', unverified: 'Unverified · check the chat', openChat: 'Open orb chat', queued: 'Queued…', connecting: 'Connecting to the model…', thinking: 'Thinking about the next step…', working: 'Running a tool…', waiting: 'Waiting for the next cycle', failed: 'Last cycle failed · check the trace', interrupted: 'Last execution was interrupted', tools: { externalBrowserList: 'Finding connected browsers…', externalBrowserState: 'Reading the tab…', externalBrowserAction: 'Interacting with the tab…', openBrowser: 'Opening a page…', getBrowserState: 'Checking the page…', browserAction: 'Interacting with the page…', readFile: 'Reading files…', searchText: 'Searching the project…', listFiles: 'Exploring files…', runCommand: 'Running a command…' }, delete: 'Delete orb', stopBeforeDelete: 'Stop the orb before deleting it', play: 'Start orb', stop: 'Stop orb', copyTrace: 'Copy execution trace', copied: 'Trace copied', off: 'Off', active: 'Active', actionError: 'Could not complete the orb action.' },
} as const;

export const orbsTranslations = {
  es: { title: 'Orbes', description: 'Diseñá tus agentes de IA y definí para qué querés usarlos.', create: 'Diseñar un orbe', edit: 'Editar orbe', steps: 'Pasos de configuración', connection: 'Conexión', design: 'Diseño', provider: 'Proveedor', model: 'Modelo', searchProvider: 'Buscar proveedor…', searchModel: 'Buscar modelo…', noResults: 'No se encontraron resultados.', apiKey: 'API key', apiKeyPlaceholder: 'Pegá tu API key', credentialSaved: 'Ya hay una clave guardada · pegá otra para reemplazarla', checkingCredential: 'Revisando credencial guardada…', required: 'requerida', optional: 'opcional', apiKeyRequired: 'Ingresá la API key para este proveedor.', apiKeySaveError: 'No se pudo guardar la API key.', providerEndpointMissing: 'Este proveedor no tiene una URL configurada.', selectProviderModel: 'Elegí un proveedor y un modelo.', continue: 'Continuar', back: 'Atrás', name: 'Nombre', namePlaceholder: 'Ej.: Revisor de código', purpose: '¿Qué hace este orbe?', purposePlaceholder: 'Describí el trabajo que querés que haga', color: 'Color del orbe', cancel: 'Cancelar', close: 'Cerrar', save: 'Guardar orbe', saving: 'Guardando…', designed: 'Diseñado', noDescription: 'Todavía no tiene un objetivo.', emptyTitle: 'Diseñá tu primer orbe', emptyDescription: 'Conectá un modelo, elegí un nombre y contá qué querés que haga.', loading: 'Cargando tus orbes…', saveError: 'No se pudo guardar este orbe.' },
  en: { title: 'Orbs', description: 'Design your AI agents and decide what they are here to do.', create: 'Design an orb', edit: 'Edit orb', steps: 'Setup steps', connection: 'Connection', design: 'Design', provider: 'Provider', model: 'Model', searchProvider: 'Search providers…', searchModel: 'Search models…', noResults: 'No results found.', apiKey: 'API key', apiKeyPlaceholder: 'Paste your API key', credentialSaved: 'A key is already saved · paste another to replace it', checkingCredential: 'Checking saved credential…', required: 'required', optional: 'optional', apiKeyRequired: 'Enter the API key for this provider.', apiKeySaveError: 'Could not save the API key.', providerEndpointMissing: 'This provider does not have a configured URL.', selectProviderModel: 'Choose a provider and model.', continue: 'Continue', back: 'Back', name: 'Name', namePlaceholder: 'e.g. Code reviewer', purpose: 'What does this orb do?', purposePlaceholder: 'Describe the work you want it to do', color: 'Orb color', cancel: 'Cancel', close: 'Close', save: 'Save orb', saving: 'Saving…', designed: 'Designed', noDescription: 'No objective yet.', emptyTitle: 'Create your first orb', emptyDescription: 'Connect a model, choose a name, and describe what you want it to do.', loading: 'Loading your orbs…', saveError: 'Could not save this orb.' },
} as const;

export const rightSidebarTranslations = {
  es: { files: 'Archivos', review: 'Revisar', browser: 'Navegador', artifacts: 'Artifacts', terminals: 'Terminales', home: 'Inicio', newTab: 'Nueva pestaña', rightPanel: 'Panel lateral derecho', resizePanel: 'Redimensionar panel derecho', toggleTree: 'Mostrar u ocultar árbol del workspace', loadingFile: 'Cargando archivo...', openFile: 'Abrir archivo', selectFile: 'Elegí un archivo del árbol para verlo acá', filterFiles: 'Filtrar archivos...', loadingFiles: 'Cargando archivos...', noFiles: 'No se encontraron archivos.', changes: 'Cambios', file: 'archivo', filesCount: 'archivos', toggleFiles: 'Mostrar u ocultar archivos', refreshChanges: 'Actualizar cambios', reviewing: 'Revisando cambios...', noPendingChanges: 'Sin cambios pendientes.', noDiff: 'No hay diff disponible para este archivo.', selectProjectReview: 'Seleccioná un proyecto para revisar sus cambios.', untracked: 'Sin seguimiento', deleted: 'Eliminado', renamed: 'Renombrado', added: 'Añadido', modified: 'Modificado', artifactsDescription: 'Elementos generados y utilizados por la IA.', plan: 'Plan', todo: 'TODO', deletePlan: 'Eliminar plan', deleteTodo: 'Eliminar TODO', noTodosPlans: 'Todavía no hay TODOs ni planes.', selectProjectArtifacts: 'Seleccioná un proyecto para ver sus artifacts.', pending: 'Pendiente', inProgress: 'En curso', completed: 'Completado', cancelled: 'Cancelado', blocked: 'Bloqueado', back: 'Atrás', forward: 'Adelante', reload: 'Recargar', selectElement: 'Seleccionar elemento', webAddress: 'Dirección web', referencePage: 'Referenciar página', moreOptions: 'Más opciones', openOutside: 'Abrir fuera de Codeclub', openUrl: 'Abrir URL', invalidUrl: 'URL inválida. Revisá el dominio o el puerto.', pageAddress: 'Escribí una dirección para navegar', selectedElement: 'Elemento seleccionado', openPage: 'Página abierta', newTerminal: 'Nueva terminal', createTerminal: 'Crear terminal', hideTerminal: 'Ocultar terminal', activateTerminal: 'Activar', closeTerminal: 'Cerrar terminal', closeTab: 'Cerrar pestaña', closeOtherTabs: 'Cerrar otras pestañas', closeTabsToRight: 'Cerrar pestañas a la derecha', browserControls: 'Controles del navegador', browserAddressPlaceholder: 'Escribí una URL para navegar', pickElement: 'Seleccionar elemento', commentPlaceholder: 'Agregá un comentario...', commentAria: 'Agregar un comentario al elemento seleccionado', pageLoadError: 'No se pudo abrir esta página', retry: 'Reintentar', terminalAria: 'Terminal PowerShell', panelManager: 'Gestor de paneles', closeRightPanel: 'Cerrar', closeOtherRightPanels: 'Cerrar otras pestañas', closeRightPanelsAfter: 'Cerrar a la derecha', addRightPanel: 'Abrir paneles de la sidebar derecha', openPanels: 'Paneles abiertos', rightPanelMenu: 'Paneles de la sidebar derecha', toggleFileTreeShow: 'Mostrar árbol de archivos', toggleFileTreeHide: 'Ocultar árbol de archivos' },
  en: { files: 'Files', review: 'Review', browser: 'Browser', artifacts: 'Artifacts', terminals: 'Terminals', home: 'Home', newTab: 'New tab', rightPanel: 'Right sidebar', resizePanel: 'Resize right sidebar', toggleTree: 'Show or hide workspace tree', loadingFile: 'Loading file...', openFile: 'Open file', selectFile: 'Choose a file from the project tree to view it here', filterFiles: 'Filter files...', loadingFiles: 'Loading files...', noFiles: 'No files found.', changes: 'Changes', file: 'file', filesCount: 'files', toggleFiles: 'Show or hide files', refreshChanges: 'Refresh changes', reviewing: 'Reviewing changes...', noPendingChanges: 'No pending changes.', noDiff: 'No diff available for this file.', selectProjectReview: 'Select a project to review its changes.', untracked: 'Untracked', deleted: 'Deleted', renamed: 'Renamed', added: 'Added', modified: 'Modified', artifactsDescription: 'Elements generated and used by AI.', plan: 'Plan', todo: 'TODO', deletePlan: 'Delete plan', deleteTodo: 'Delete TODO', noTodosPlans: 'There are no TODOs or plans yet.', selectProjectArtifacts: 'Select a project to view its artifacts.', pending: 'Pending', inProgress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', blocked: 'Blocked', back: 'Back', forward: 'Forward', reload: 'Reload', selectElement: 'Select element', webAddress: 'Web address', referencePage: 'Reference page', moreOptions: 'More options', openOutside: 'Open outside Codeclub', openUrl: 'Open URL', invalidUrl: 'Invalid URL. Check the domain or port.', pageAddress: 'Enter an address to browse', openPage: 'Open page', newTerminal: 'New terminal', createTerminal: 'Create terminal', hideTerminal: 'Hide terminal', activateTerminal: 'Activate', closeTab: 'Close tab', closeOtherTabs: 'Close other tabs', closeTabsToRight: 'Close tabs to the right', browserControls: 'Browser controls', browserAddressPlaceholder: 'Enter a URL to browse', pickElement: 'Select element', commentPlaceholder: 'Add a comment...', commentAria: 'Add a comment to the selected element', pageLoadError: 'Could not open this page', retry: 'Retry', terminalAria: 'PowerShell terminal', panelManager: 'Panel manager', closeRightPanel: 'Close', closeOtherRightPanels: 'Close other tabs', closeRightPanelsAfter: 'Close tabs to the right', addRightPanel: 'Open right sidebar panels', openPanels: 'Open panels', rightPanelMenu: 'Right sidebar panels', toggleFileTreeShow: 'Show file tree', toggleFileTreeHide: 'Hide file tree' },
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

export const savedProviderTranslations = {
  es: { recent: 'Reciente' },
  en: { recent: 'Recent' },
};

export const resourceMenuTranslations = {
  es: { resources: 'Recursos seleccionados', remove: 'Quitar referencia', plugin: 'Extensión', extension: 'Extensión integrada', mcp: 'MCP', orb: 'Orbe', skill: 'Skill', global: 'Global', project: 'Proyecto', readOnly: 'Integrado · solo lectura', createExtension: 'Crear extensión', createSkill: 'Crear skill', createMcp: 'Crear MCP', createOrb: 'Crear orbe', createDescription: 'Preparar un pedido en el chat', createPrompt: 'Quiero crear un recurso de tipo', detailPrompt: 'Describí su nombre y qué debe hacer.' },
  en: { resources: 'Selected resources', remove: 'Remove reference', plugin: 'Extension', extension: 'Built-in extension', mcp: 'MCP', orb: 'Orb', skill: 'Skill', global: 'Global', project: 'Project', readOnly: 'Built-in · read only', createExtension: 'Create extension', createSkill: 'Create skill', createMcp: 'Create MCP', createOrb: 'Create orb', createDescription: 'Prepare a request in chat', createPrompt: 'I want to create a resource of type', detailPrompt: 'Describe its name and what it should do.' },
} as const;
