import { useEffect, useState } from 'react';

export type AppLanguage = 'es' | 'en';

export const LANGUAGE_STORAGE_KEY = 'codeclub-language';
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

export const scheduledRuntimeTranslations = {
  es: {
    availability: 'Las tareas se ejecutan mientras Codeclub está abierto, incluso en la bandeja. Al volver de una suspensión se ejecuta una vez la tarea pendiente.',
    once: 'Una vez', runAt: 'Fecha y hora del dispositivo', timeZone: 'Zona horaria', weekday: 'Día de la semana', days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    intervals: { Diario: 'Diario', 'Días hábiles': 'Días hábiles', Semanal: 'Semanal', Personalizado: 'Personalizado', 'Una vez': 'Una vez' },
    history: 'Historial de ejecuciones', noRuns: 'Todavía no hubo ejecuciones.', result: 'Abrir resultado', cancel: 'Cancelar ejecución', next: 'Próxima ejecución', reasoning: 'Razonamiento', efforts: ['Bajo', 'Medio', 'Alto'], loading: 'Cargando tareas…',
    loadError: 'No se pudieron cargar las tareas.', actionError: 'No se pudo completar la acción. Revisá los campos y si la tarea ya está ejecutándose.',
    states: { queued: 'En cola', running: 'Ejecutándose', completed: 'Completada', failed: 'Falló', cancelled: 'Cancelada', interrupted: 'Interrumpida' },
    errors: { TASK_CREDENTIAL_MISSING: 'Falta configurar la credencial.', TASK_MODEL_UNAVAILABLE: 'El proveedor o modelo ya no está disponible.', TASK_APPROVAL_REQUIRED: 'Una operación no recibió aprobación. Abrí el resultado para revisarla.', TASK_USER_INPUT_REQUIRED: 'La tarea necesita una respuesta tuya.', TASK_STEP_LIMIT: 'La tarea alcanzó el límite de pasos.', TASK_CANCELLED: 'La ejecución fue cancelada.', TASK_TIMEOUT: 'La ejecución excedió los 30 minutos.', TASK_INTERRUPTED: 'La ejecución fue interrumpida.', TASK_EXECUTION_FAILED: 'La ejecución falló. Abrí el resultado para revisarla.', TASK_RUNNER_UNAVAILABLE: 'No se pudo iniciar la ejecución.' },
  },
  en: {
    availability: 'Tasks run while Codeclub is open, including in the system tray. After sleep, each overdue task runs once.',
    once: 'Once', runAt: 'Date and time on this device', timeZone: 'Time zone', weekday: 'Day of the week', days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    intervals: { Diario: 'Daily', 'Días hábiles': 'Weekdays', Semanal: 'Weekly', Personalizado: 'Custom', 'Una vez': 'Once' },
    history: 'Run history', noRuns: 'No runs yet.', result: 'Open result', cancel: 'Cancel run', next: 'Next run', reasoning: 'Reasoning', efforts: ['Low', 'Medium', 'High'], loading: 'Loading tasks…',
    loadError: 'Could not load tasks.', actionError: 'Could not complete the action. Check the fields and whether the task is already running.',
    states: { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' },
    errors: { TASK_CREDENTIAL_MISSING: 'Configure the provider credential.', TASK_MODEL_UNAVAILABLE: 'The provider or model is no longer available.', TASK_APPROVAL_REQUIRED: 'An operation was not approved. Open the result to review it.', TASK_USER_INPUT_REQUIRED: 'The task needs your input.', TASK_STEP_LIMIT: 'The task reached its step limit.', TASK_CANCELLED: 'The run was cancelled.', TASK_TIMEOUT: 'The run exceeded 30 minutes.', TASK_INTERRUPTED: 'The run was interrupted.', TASK_EXECUTION_FAILED: 'The run failed. Open the result to review it.', TASK_RUNNER_UNAVAILABLE: 'Could not start the run.' },
  },
} as const;

export const sidebarTranslations = {
  es: {
    market: 'Mercado',
    chat: 'Chat', projects: 'Proyectos', agents: 'Agentes', extensions: 'Extensiones', chats: 'Chats', settings: 'Ajustes', tasks: 'Tareas', devices: 'Varios', recent: 'Recientes', support: 'Apoyar Codeclub',
    projectName: 'Nombre del proyecto', renameProject: 'Cambiar nombre del proyecto', saveProjectName: 'Guardar nombre del proyecto', renameProjectError: 'No se pudo cambiar el nombre del proyecto.', newFile: 'Nuevo archivo', newFolder: 'Nueva carpeta', ready: 'Listo para revisión', workspace: 'Espacio de trabajo', leftSidebar: 'Barra lateral izquierda', mainNavigation: 'Navegación principal', chatMenu: 'Menú del chat', donation: 'Hacer una donación',
    couldNotCreate: 'No se pudo crear', newChat: 'Nuevo chat', createNew: 'Crear nuevo...', open: 'Abrir', close: 'Cerrar', rename: 'Renombrar', delete: 'Eliminar', clearChats: 'Limpiar chats', clearHistory: 'Limpiar historial', clearProjectChats: 'Limpiar todos los chats de este proyecto', newName: 'Nuevo nombre', deleteElement: 'Eliminar elemento', selectFolder: 'Seleccionar carpeta para el proyecto',
  },
  en: {
    market: 'Market',
    chat: 'Chat', projects: 'Projects', agents: 'Agents', extensions: 'Extensions', chats: 'Chats', settings: 'Settings', tasks: 'Tasks', devices: 'Miscellaneous', recent: 'Recent', support: 'Support Codeclub',
    projectName: 'Project name', renameProject: 'Rename project', saveProjectName: 'Save project name', renameProjectError: 'Could not rename the project.', newFile: 'New file', newFolder: 'New folder', ready: 'Ready for review', workspace: 'Workspace', leftSidebar: 'Left sidebar', mainNavigation: 'Main navigation', chatMenu: 'Chat menu', donation: 'Make a donation',
    couldNotCreate: 'Could not create', newChat: 'New chat', createNew: 'Create new...', open: 'Open', close: 'Close', rename: 'Rename', delete: 'Delete', clearChats: 'Clear chats', clearHistory: 'Clear history', clearProjectChats: 'Clear all chats from this project', newName: 'New name', deleteElement: 'Delete item', selectFolder: 'Select folder for project',
  },
} as const;

export const providerRegistrationTranslations = {
  es: { title: 'Ser proveedor', editTitle: 'Editar modelo', saveChanges: 'Guardar cambios', description: 'Configurá el modelo que querés ofrecer desde tu computadora.', name: 'Nombre público', namePlaceholder: 'Cómo te verán los consumidores', origin: 'Origen del modelo', local: 'Modelo local', codeclub: 'Codeclub', provider: 'Proveedor', selectProvider: 'Seleccionar proveedor', selectModel: 'Seleccionar modelo', apiKey: 'API key', keepCredential: 'Usar credencial guardada', enterKey: 'Ingresá tu API key', keyNote: 'Se guarda en el vault de credenciales de Codeclub.', localNote: 'Ingresá los datos de tu servidor local, como Ollama o LM Studio.', codeclubNote: 'Elegí un proveedor y un modelo del catálogo de Codeclub.', endpoint: 'Endpoint', endpointNote: 'Dirección privada para Codeclub. No se publica a los consumidores.', model: 'Identificador del modelo', modelPlaceholder: 'Nombre del modelo en tu servidor', modelLabel: 'Etiqueta del modelo', modelLabelPlaceholder: 'Nombre que verán los consumidores', concurrency: 'Solicitudes simultáneas', requestLimit: 'Peticiones por minuto', requestLimitNote: '0 significa sin límite. Se aplica al total del proveedor.', queue: 'Habilitar cola de ejecución', queueNote: 'Las solicitudes esperan por orden de llegada cuando se alcanza un límite. Si la cola se llena, se rechazan las nuevas.', noQueueNote: 'Al alcanzar un límite, se rechazan las nuevas solicitudes.', queueCapacity: 'Máximo de solicitudes en espera', invalidLimits: 'Revisá los límites: simultáneas de 1 a 32, peticiones de 0 a 100000 y cola de 1 a 1000.', draftNote: 'Tu registro aparecerá en el Mercado de este dispositivo. La conexión y la ejecución de solicitudes todavía no están habilitadas.', save: 'Registrarme', saving: 'Guardando…', cancel: 'Cancelar', close: 'Cerrar registro de proveedor', loading: 'Cargando borrador…', error: 'No se pudo registrar el proveedor.', loadError: 'No se pudo cargar el borrador. Cerrá el modal e intentá de nuevo.', invalidEndpoint: 'Ingresá una URL HTTP o HTTPS con host y puerto si corresponde, sin credenciales ni parámetros.' },
  en: { title: 'Become a provider', editTitle: 'Edit model', saveChanges: 'Save changes', description: 'Configure the model you want to offer from your computer.', name: 'Public name', namePlaceholder: 'How consumers will see you', origin: 'Model source', local: 'Local model', codeclub: 'Codeclub', provider: 'Provider', selectProvider: 'Select provider', selectModel: 'Select model', apiKey: 'API key', keepCredential: 'Use saved credential', enterKey: 'Enter your API key', keyNote: 'Stored in the Codeclub credential vault.', localNote: 'Enter your local server details, such as Ollama or LM Studio.', codeclubNote: 'Choose a provider and model from the Codeclub catalog.', endpoint: 'Endpoint', endpointNote: 'Private address for Codeclub. Not published to consumers.', model: 'Model identifier', modelPlaceholder: 'Model name on your server', modelLabel: 'Model label', modelLabelPlaceholder: 'Name shown to consumers', concurrency: 'Concurrent requests', requestLimit: 'Requests per minute', requestLimitNote: '0 means unlimited. Applies to the provider total.', queue: 'Enable execution queue', queueNote: 'Requests wait in arrival order when a limit is reached. New requests are rejected when the queue is full.', noQueueNote: 'New requests are rejected when a limit is reached.', queueCapacity: 'Maximum waiting requests', invalidLimits: 'Check the limits: concurrency from 1 to 32, requests from 0 to 100000 and queue from 1 to 1000.', draftNote: 'Your registration will appear in the Market on this device. Connection and request execution are not enabled yet.', save: 'Register', saving: 'Saving…', cancel: 'Cancel', close: 'Close provider registration', loading: 'Loading draft…', error: 'Could not register the provider.', loadError: 'Could not load the draft. Close the dialog and try again.', invalidEndpoint: 'Enter an HTTP or HTTPS URL with a host and optional port, without credentials or parameters.' },
} as const;

export const marketTranslations = {
  es: { title: 'Mercado', description: 'Explorá proveedores que ofrecen sus modelos de IA desde sus propias computadoras.', search: 'Buscar proveedores', available: 'Proveedores', becomeProvider: 'Agregar', status: 'Estado', edit: 'Editar modelo', remove: 'Eliminar modelo', actionError: 'No se pudo actualizar el modelo.', activate: 'Activar', pause: 'Pausar', active: 'Activo', paused: 'Pausado', statusNote: 'Administrá tus modelos registrados. El estado se guarda en este dispositivo; la publicación online todavía no está habilitada.', connect: 'Conectarse', disconnect: 'Desconectarse', connectionError: 'No se pudo cambiar la conexión del proveedor.', loading: 'Cargando proveedores…', loadError: 'No se pudieron cargar los proveedores.', retry: 'Reintentar', localModel: 'Modelo local', localRegistration: 'Registro local', concurrent: 'Simultáneas', rate: 'Peticiones/min', unlimited: 'Sin límite', queue: 'Cola', disabled: 'Desactivada', empty: 'Todavía no hay proveedores registrados.', noResults: 'No se encontraron proveedores.' },
  en: { title: 'Market', description: 'Explore providers offering their AI models from their own computers.', search: 'Search providers', available: 'Providers', becomeProvider: 'Add', status: 'Status', edit: 'Edit model', remove: 'Delete model', actionError: 'Could not update the model.', activate: 'Activate', pause: 'Pause', active: 'Active', paused: 'Paused', statusNote: 'Manage your registered models. Status is saved on this device; online publishing is not enabled yet.', connect: 'Connect', disconnect: 'Disconnect', connectionError: 'Could not change the provider connection.', loading: 'Loading providers…', loadError: 'Could not load providers.', retry: 'Retry', localModel: 'Local model', localRegistration: 'Local registration', concurrent: 'Concurrent', rate: 'Requests/min', unlimited: 'Unlimited', queue: 'Queue', disabled: 'Disabled', empty: 'No providers have registered yet.', noResults: 'No providers found.' },
} as const;

export const rightSidebarTranslations = {
  es: { files: 'Archivos', review: 'Revisar', browser: 'Navegador', artifacts: 'Artifacts', terminals: 'Terminales', home: 'Inicio', newTab: 'Nueva pestaña', rightPanel: 'Panel lateral derecho', resizePanel: 'Redimensionar panel derecho', toggleTree: 'Mostrar u ocultar árbol del workspace', loadingFile: 'Cargando archivo...', openFile: 'Abrir archivo', selectFile: 'Elegí un archivo del árbol para verlo acá', filterFiles: 'Filtrar archivos...', loadingFiles: 'Cargando archivos...', noFiles: 'No se encontraron archivos.', changes: 'Cambios', file: 'archivo', filesCount: 'archivos', toggleFiles: 'Mostrar u ocultar archivos', refreshChanges: 'Actualizar cambios', reviewing: 'Revisando cambios...', noPendingChanges: 'Sin cambios pendientes.', noDiff: 'No hay diff disponible para este archivo.', selectProjectReview: 'Seleccioná un proyecto para revisar sus cambios.', untracked: 'Sin seguimiento', deleted: 'Eliminado', renamed: 'Renombrado', added: 'Añadido', modified: 'Modificado', artifactsDescription: 'Elementos generados y utilizados por la IA.', plan: 'Plan', todo: 'TODO', deletePlan: 'Eliminar plan', deleteTodo: 'Eliminar TODO', noTodosPlans: 'Todavía no hay TODOs ni planes.', selectProjectArtifacts: 'Seleccioná un proyecto para ver sus artifacts.', pending: 'Pendiente', inProgress: 'En curso', completed: 'Completado', cancelled: 'Cancelado', blocked: 'Bloqueado', back: 'Atrás', forward: 'Adelante', reload: 'Recargar', selectElement: 'Seleccionar elemento', webAddress: 'Dirección web', referencePage: 'Referenciar página', moreOptions: 'Más opciones', openOutside: 'Abrir fuera de Codeclub', openUrl: 'Abrir URL', invalidUrl: 'URL inválida. Revisá el dominio o el puerto.', pageAddress: 'Escribí una dirección para navegar', selectedElement: 'Elemento seleccionado', openPage: 'Página abierta', newTerminal: 'Nueva terminal', createTerminal: 'Crear terminal', hideTerminal: 'Ocultar terminal', activateTerminal: 'Activar', closeTerminal: 'Cerrar terminal', closeTab: 'Cerrar pestaña', closeOtherTabs: 'Cerrar otras pestañas', closeTabsToRight: 'Cerrar pestañas a la derecha', browserControls: 'Controles del navegador', browserAddressPlaceholder: 'Escribí una URL para navegar', pickElement: 'Seleccionar elemento', commentPlaceholder: 'Agregá un comentario...', commentAria: 'Agregar un comentario al elemento seleccionado', pageLoadError: 'No se pudo abrir esta página', retry: 'Reintentar', terminalAria: 'Terminal PowerShell', panelManager: 'Gestor de paneles', scheduledTasks: 'Tareas programadas', closeRightPanel: 'Cerrar', closeOtherRightPanels: 'Cerrar otras pestañas', closeRightPanelsAfter: 'Cerrar a la derecha', addRightPanel: 'Abrir paneles de la sidebar derecha', openPanels: 'Paneles abiertos', rightPanelMenu: 'Paneles de la sidebar derecha', toggleFileTreeShow: 'Mostrar árbol de archivos', toggleFileTreeHide: 'Ocultar árbol de archivos' },
  en: { files: 'Files', review: 'Review', browser: 'Browser', artifacts: 'Artifacts', terminals: 'Terminals', home: 'Home', newTab: 'New tab', rightPanel: 'Right sidebar', resizePanel: 'Resize right sidebar', toggleTree: 'Show or hide workspace tree', loadingFile: 'Loading file...', openFile: 'Open file', selectFile: 'Choose a file from the project tree to view it here', filterFiles: 'Filter files...', loadingFiles: 'Loading files...', noFiles: 'No files found.', changes: 'Changes', file: 'file', filesCount: 'files', toggleFiles: 'Show or hide files', refreshChanges: 'Refresh changes', reviewing: 'Reviewing changes...', noPendingChanges: 'No pending changes.', noDiff: 'No diff available for this file.', selectProjectReview: 'Select a project to review its changes.', untracked: 'Untracked', deleted: 'Deleted', renamed: 'Renamed', added: 'Added', modified: 'Modified', artifactsDescription: 'Elements generated and used by AI.', plan: 'Plan', todo: 'TODO', deletePlan: 'Delete plan', deleteTodo: 'Delete TODO', noTodosPlans: 'There are no TODOs or plans yet.', selectProjectArtifacts: 'Select a project to view its artifacts.', pending: 'Pending', inProgress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', blocked: 'Blocked', back: 'Back', forward: 'Forward', reload: 'Reload', selectElement: 'Select element', webAddress: 'Web address', referencePage: 'Reference page', moreOptions: 'More options', openOutside: 'Open outside Codeclub', openUrl: 'Open URL', invalidUrl: 'Invalid URL. Check the domain or port.', pageAddress: 'Enter an address to browse', openPage: 'Open page', newTerminal: 'New terminal', createTerminal: 'Create terminal', hideTerminal: 'Hide terminal', activateTerminal: 'Activate', closeTab: 'Close tab', closeOtherTabs: 'Close other tabs', closeTabsToRight: 'Close tabs to the right', browserControls: 'Browser controls', browserAddressPlaceholder: 'Enter a URL to browse', pickElement: 'Select element', commentPlaceholder: 'Add a comment...', commentAria: 'Add a comment to the selected element', pageLoadError: 'Could not open this page', retry: 'Retry', terminalAria: 'PowerShell terminal', panelManager: 'Panel manager', scheduledTasks: 'Scheduled tasks', closeRightPanel: 'Close', closeOtherRightPanels: 'Close other tabs', closeRightPanelsAfter: 'Close tabs to the right', addRightPanel: 'Open right sidebar panels', openPanels: 'Open panels', rightPanelMenu: 'Right sidebar panels', toggleFileTreeShow: 'Show file tree', toggleFileTreeHide: 'Hide file tree' },
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
