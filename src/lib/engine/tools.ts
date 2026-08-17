import { nativeInvoke as invoke } from '../runtime';
import { jsonSchema as aiJsonSchema, tool } from 'ai';
import type { ToolContext } from './types';
import { runStream } from './run';
import { createId, readAgentState, writeAgentState, type TaskStatus } from './planning';
import { appendGenerationUsage } from '../usage';
import { readExecutionLog } from '../execution-log';
import { readProjectIndex } from '../projectManager';

const jsonSchema = (schema: unknown) => aiJsonSchema<any>(schema as any);

const specialistHandoff = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

const TOOL_GUIDANCE: Record<string, string> = {
  computerGetState: 'Si la app solo expone un Pane o no devuelve un TextBox/Input, no esperes otro control: ejecuta computerScreenshot y usa la imagen para ubicar el input. Para interactuar por coordenadas, hace computerAction click con x/y y luego computerAction type o key.',
  computerScreenshot: 'Usa la imagen para ubicar visualmente el control cuando UI Automation no exponga elementos. Despues hace click con x/y, escribi y verifica con otra captura.',
  computerOcr: 'Usa el texto y las cajas devueltas por OCR para convertir una etiqueta visible en coordenadas. La confianza es orientativa, no garantiza reconocimiento perfecto.',
  listFiles: 'Usá la lista como evidencia del workspace y, si necesitás detalles, leé los archivos relevantes.',
  readFile: 'Basate únicamente en el contenido leído; no afirmes cambios sin una tool de escritura o verificación.',
  searchText: 'Si hay coincidencias, citá rutas y líneas; si está vacíoo, informá que no hubo resultados.',
  writeFile: 'Verificá el archivo escrito leyendo o inspeccionando el estado posterior antes de afirmar que quedó correcto.',
  runCommand: 'Interpretá la salida real, incluyendo errores y código de salida; no conviertas un intento en éxito.',
  terminal: 'La terminal puede quedar ejecutándose; observá su estado o salida antes de declarar el proceso listo.',
  openBrowser: 'Después de abrir, consultá el estado del navegador para confirmar URL, título y contenido.',
  getBrowserState: 'Usá URL, título, texto y elementos observables como evidencia; no inventes contenido ausente.',
  browserAction: 'Después de actuar, observá nuevamente el navegador para verificar el efecto real de la acción.',
  createPlan: 'Usá el plan creado para coordinar pasos y actualizalo cuando cambie el estado real.',
  updatePlan: 'Reportá el estado devuelto por la tool y no marques pasos como completados sin evidencia.',
  getTaskStatus: 'Compará el estado actual con el objetivo y señalá planes o pasos pendientes y desactualizados.',
  getExecutionLog: 'Usá el log como evidencia histórica; separá errores recuperados de operaciones exitosas.',
};

function withAgentGuidance(toolName: string, value: unknown) {
  const failed = Boolean(value && typeof value === 'object' && !Array.isArray(value) && ((value as any).ok === false || (value as any).error));
  const guidance = TOOL_GUIDANCE[toolName] || (failed
    ? 'La operación falló: informá el error real y proponé el siguiente paso seguro.'
    : 'Usá este resultado como evidencia, verificá el estado posterior cuando corresponda y no inventes datos.');
  const agentGuidance = {
    kind: 'workflow_hint',
    trust: 'untrusted_data',
    instruction: failed ? 'La tool reportá un error. No declares éxito.' : guidance,
  };
  if (Array.isArray(value)) return { items: value, agentGuidance };
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>), agentGuidance };
  return { result: value, agentGuidance };
}

function wrapToolSet<T extends Record<string, any>>(tools: T): T {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    if (!definition?.execute) return [name, definition];
    return [name, {
      ...definition,
      execute: async (...args: any[]) => withAgentGuidance(name, await definition.execute(...args)),
    }];
  })) as T;
}

const persistSubagentUsage = async (projectPath: string, modelId: string, mode: string, usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; model?: string; durationMs: number }) => appendGenerationUsage({
  id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  at: new Date().toISOString(),
  projectPath,
  chatId: 'subagent',
  mode,
  provider: modelId,
  model: usage.model || modelId,
  inputTokens: usage.inputTokens ?? null,
  outputTokens: usage.outputTokens ?? null,
  totalTokens: usage.totalTokens ?? null,
  reasoningTokens: usage.reasoningTokens ?? null,
  durationMs: usage.durationMs,
  status: 'completed',
});

function createSubagentTools(ctx: { projectPath: string; recordToolEvent: (name: string, input: any, output: any) => void; setAgentState: (state: string) => void }) {
  const { projectPath, recordToolEvent, setAgentState } = ctx;
  return wrapToolSet({
    listFiles: tool({
      description: 'List project files in the active workspace. Skips heavy folders.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          maxFiles: { type: 'number', description: 'Maximum files to return. Default 400.' },
        },
        additionalProperties: false,
      }),
      execute: async ({ maxFiles }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_list_files', {
          projectPath,
          maxFiles: Math.min(Number(maxFiles) || 400, 1200),
        });
        recordToolEvent('listFiles', { maxFiles }, output);
        return output;
      },
    }),
    readFile: tool({
      description: 'Read a UTF-8 text file from the active workspace using a relative path.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
        },
        required: ['path'],
        additionalProperties: false,
      }),
      execute: async ({ path }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_read_file', { projectPath, path });
        recordToolEvent('readFile', { path }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchText: tool({
      description: 'Search exact text in workspace files and return path, line, and preview.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text to search for.' },
          maxMatches: { type: 'number', description: 'Maximum matches. Default 80.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async ({ query, maxMatches }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_search_text', {
          projectPath,
          query,
          maxMatches: Math.min(Number(maxMatches) || 80, 200),
        });
        recordToolEvent('searchText', { query, maxMatches }, output);
        return output;
      },
    }),
  });
}

const SWARM_DISPLAY_NAMES = ['Atlas', 'Hermes', 'Atenea', 'Apolo', 'Artemisa', 'Nix', 'Gaia', 'Eros'];
const CHILD_DISPLAY_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const MAX_ACTIVE_CHILDREN = 4;
type SwarmChild = { id: string; name: string; specialist: string; task: string; status: string; messages: string[]; result?: string };
type SwarmState = { id: string; name: string; status: string; children: Record<string, SwarmChild> };
const swarmStore = new Map<string, SwarmState>();
const swarmChildTools = new Map<string, Record<string, any>>();
const PARENT_ONLY_TOOLS = new Set(['createPlan', 'updatePlan', 'todo', 'getTaskStatus']);
const normalizeBrowserUrl = (raw: string) => {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
};

function createSwarmTool(ctx: { projectPath: string; projectScoped?: boolean; recordToolEvent: (name: string, input: any, output: any) => void; setAgentState: (state: string) => void; requestToolApproval?: (opts: { toolName: string; input: any; summary: string }) => Promise<boolean>; childTools?: Record<string, any>; provider?: any; modelId?: string }) {
  const { projectPath, projectScoped = false, recordToolEvent, setAgentState, childTools = {}, provider, modelId } = ctx;
  const runChild = async (_swarm: SwarmState, child: SwarmChild, message: string) => {
    if (!provider || !modelId) return { error: 'No hay modelo configurado para el swarm.' };
    child.status = 'running';
    child.messages.push(message);
    const tools = swarmChildTools.get(child.id) || childTools;
    const result = await runStream({
      model: provider(modelId),
      system: `Sos el hijo ${child.specialist} del swarm de Codeclub. ${projectScoped ? 'Trabajás únicamente dentro del proyecto activo.' : 'No hay proyecto seleccionado: trabajás sobre el alcance global de la máquina y no debés afirmar que estás aislado.'} Respondé con hallazgos concretos y evidencia. No inventes resultados.`,
      messages: [{ role: 'user', content: child.messages.join('\n\n') }],
      tools,
      callbacks: { onTextDelta: () => {}, onUsage: (usage) => persistSubagentUsage(projectPath, modelId, `swarm-${child.specialist}`, usage) },
    });
    child.result = specialistHandoff(result);
    child.status = 'completed';
    return { childName: child.name, status: child.status, result: child.result };
  };
  return wrapToolSet({
    swarm: tool({
      description: 'Create and manage a swarm of child agents. The parent can spawn, message, broadcast, wait, approve, reject, merge or stop children.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['spawn', 'sendMessage', 'broadcast', 'wait', 'approve', 'reject', 'merge', 'stop'] },
          swarmName: { type: 'string' },
          childName: { type: 'string' },
          specialist: { type: 'string' },
          task: { type: 'string', maxLength: 1000 },
          message: { type: 'string', maxLength: 1000 },
          template: { type: 'string', enum: ['read_only', 'developer', 'custom'] },
          tools: { type: 'array', items: { type: 'string' }, maxItems: 30 },
        },
        required: ['action'],
        additionalProperties: false,
      }),
      execute: async ({ action, swarmId, swarmName, childId, childName, specialist, task, message, template, tools: requestedTools }) => {
        setAgentState('tool_call');
        let swarm = swarmId ? swarmStore.get(swarmId) : swarmName ? Array.from(swarmStore.values()).find((item) => item.name === swarmName) : undefined;
        if (action === 'spawn') {
          const id = swarmId || createId('swarm');
          const displayName = swarmName || SWARM_DISPLAY_NAMES[Math.floor(Math.random() * SWARM_DISPLAY_NAMES.length)];
          swarm = swarm || { id, name: displayName, status: 'active', children: {} };
          const activeChildren = Object.values(swarm.children).filter((item) => !['completed', 'rejected', 'stopped'].includes(item.status));
          if (activeChildren.length >= MAX_ACTIVE_CHILDREN) {
            return { swarmName: swarm.name, status: 'blocked', error: `Límite de ${MAX_ACTIVE_CHILDREN} hijos activos alcanzado. Esperá, mergeá o detené uno antes de crear otro.` };
          }
          const name = childName || CHILD_DISPLAY_NAMES[Object.keys(swarm.children).length % CHILD_DISPLAY_NAMES.length];
          const child: SwarmChild = { id: childId || createId('child'), name, specialist: specialist || template || 'explorer', task: task || '', status: 'pending', messages: [] };
          const selectedTools = template === 'read_only'
            ? Object.fromEntries(Object.entries(childTools).filter(([name]) => ['listFiles', 'readFile', 'searchText'].includes(name)))
            : requestedTools?.length
              ? Object.fromEntries(requestedTools.filter((name: string) => childTools[name] && !PARENT_ONLY_TOOLS.has(name) && !['swarm', 'subagent'].includes(name)).map((name: string) => [name, childTools[name]]))
              : Object.fromEntries(Object.entries(childTools).filter(([name]) => !PARENT_ONLY_TOOLS.has(name) && !['swarm', 'subagent', 'listAvailableTools'].includes(name)));
          const originalTools = Object.keys(childTools);
          Object.assign(child as any, { toolNames: Object.keys(selectedTools), availableToolNames: originalTools });
          swarm.children[child.id] = child;
          swarmStore.set(id, swarm);
          swarmChildTools.set(child.id, selectedTools);
          const output = await runChild(swarm, child, child.task);
          const result = { swarmName: swarm.name, childName: child.name, ...output };
          recordToolEvent('swarm', { action, swarmId: id, swarmName: swarm.name, childId: child.id, childName: child.name, specialist: child.specialist }, result);
          return result;
        }
        if (!swarm) return { error: 'Swarm inexistente.' };
        const child = childId ? swarm.children[childId] : childName ? Object.values(swarm.children).find((item) => item.name === childName) : undefined;
        if (action === 'sendMessage' && child) return runChild(swarm, child, message || '');
        if (action === 'broadcast') {
          const results = await Promise.all(Object.values(swarm.children).filter((item) => item.status !== 'rejected' && item.status !== 'stopped').map((item) => runChild(swarm!, item, message || '')));
          return { swarmName: swarm.name, results };
        }
        if (action === 'approve' && child) child.status = 'approved';
        if (action === 'reject' && child) child.status = 'rejected';
        if (action === 'stop') swarm.status = 'stopped';
        if (action === 'merge') return { swarmName: swarm.name, results: Object.values(swarm.children).map(({ name, specialist, status, result }) => ({ name, specialist, status, result })) };
        if (action === 'wait') return { swarmName: swarm.name, status: swarm.status, children: Object.values(swarm.children).map(({ name, specialist, status, result }) => ({ name, specialist, status, result })) };
        const result = { swarmName: swarm.name, childName: child?.name || null, status: child?.status || swarm.status };
        recordToolEvent('swarm', { action, swarmId: swarm.id, childId }, result);
        return result;
      },
    }),
  });
}



export function selectToolsForPrompt(toolset: Record<string, any>, _mode: 'development', prompt: string) {
  const text = prompt.toLowerCase();
  const keys = new Set(['searchTools', 'executeTool', 'askUser', 'createPlan', 'updatePlan', 'todo', 'getTaskStatus']);

  const add = (...names: string[]) => names.forEach((name) => keys.add(name));
  const has = (...terms: string[]) => terms.some((term) => text.includes(term));
  if (has('controlar la pc', 'control de pc', 'computadora', 'mouse', 'teclado', 'windows', 'notepad', 'bloc de notas', 'chatgpt', 'app de escritorio', 'aplicación de escritorio', 'aplicacion de escritorio')) add('computerListWindows', 'computerGetState', 'computerScreenshot', 'computerOcr', 'computerAction');

  // Failsafe de escritura: el router IA sigue siendo la decisión principal.
  if (has('editar', 'modific', 'crear', 'crea', 'creá', 'armar', 'armá', 'hacer', 'hacé', 'agregar', 'agrega', 'agregá', 'meter', 'mete', 'meté', 'carpeta', 'archivo', 'txt', 'escrib', 'implement', 'fix', 'correg', 'refactor', 'cambio')) add('writeFile');
  if (has('habilidad', 'skill', 'agent plugin')) add('createSkill');
  if (has('complemento', 'extension', 'plugin')) add('createExtension', 'deleteExtension');
  if (has('mcp', 'servidor de tools', 'model context protocol')) add('createMcpServer', 'deleteMcpServer');
  if (has('terminal', 'comando', 'ejecut', 'build', 'compil', 'test', 'prueba', 'git', 'servidor', 'background', 'proceso', 'bloc', 'notepad', 'pc', 'computadora')) add('runCommand', 'terminal');
  if (has('sub-ia', 'subia', 'subagente', 'especialista', 'deleg')) add('subagent');
  if (has('navegador', 'browser', 'web', 'url', 'dom', 'elemento', 'botón', 'boton', 'click', 'clic', 'escrib')) add('openBrowser', 'getBrowserState', 'browserAction');
  if (has('log', 'auditar', 'ejecución', 'ejecucion', 'herramientas', 'debug')) add('getExecutionLog');

  if (_mode === 'development' && has('control de pc', 'computadora', 'mouse', 'teclado', 'navegador', 'edge', 'notepad', 'bloc de notas', 'chatgpt', 'app de escritorio', 'aplicación de escritorio', 'aplicacion de escritorio')) add('subagent', 'runCommand', 'openBrowser', 'getBrowserState', 'browserAction');

  return Object.fromEntries([...keys].filter((name) => toolset[name]).map((name) => [name, toolset[name]]));
}

export function createDynamicToolAccess(availableTools: Record<string, any>, recordToolEvent?: (name: string, input: any, output: any) => void) {
  const keywordMap: Record<string, string[]> = {
    listFiles: ['archivos', 'archivo', 'carpetas', 'carpeta', 'workspace', 'proyecto', 'inspeccionar', 'listar', 'files', 'folders'],
    readFile: ['leer', 'archivo', 'contenido', 'file', 'read'],
    searchText: ['buscar', 'busqueda', 'texto', 'todo', 'encontrar', 'search'],
    writeFile: ['crear', 'editar', 'escribir', 'modificar', 'archivo', 'write'],
    createSkill: ['habilidad', 'skill', 'instrucciones', 'codeclub'],
    createExtension: ['complemento', 'extension', 'plugin', 'integracion'],
    deleteExtension: ['eliminar complemento', 'borrar extension', 'quitar plugin'],
    createMcpServer: ['mcp', 'servidor', 'conectar tools'],
    deleteMcpServer: ['eliminar mcp', 'borrar servidor', 'quitar mcp'],
    runCommand: ['comando', 'ejecutar', 'diagnostico', 'proceso', 'shell', 'command'],
    terminal: ['terminal', 'servidor', 'background', 'proceso'],
    openBrowser: ['navegador', 'browser', 'web', 'url', 'abrir'],
    getBrowserState: ['navegador', 'browser', 'estado', 'observar', 'dom'],
    browserAction: ['click', 'escribir', 'scroll', 'navegador', 'browser', 'accion'],
    computerListWindows: ['windows', 'ventanas', 'aplicaciones', 'pc', 'computadora', 'desktop'],
    computerGetState: ['estado', 'ventana', 'controles', 'accesibilidad', 'ui automation', 'pc', 'windows'],
    computerScreenshot: ['captura', 'pantalla', 'desktop', 'pc', 'computadora', 'windows'],
    computerOcr: ['ocr', 'texto visible', 'leer pantalla', 'leer texto', 'reconocer texto', 'coordenadas'],
    computerAction: ['mouse', 'teclado', 'click', 'clic', 'escribir', 'enfocar', 'activar ventana', 'controlar', 'windows', 'pc'],
    switchProject: ['proyecto', 'proyectos', 'cambiar', 'seleccionar', 'workspace', 'sin proyecto'],
    getExecutionLog: ['log', 'registro', 'ejecucion', 'auditoria', 'tiempos', 'rendimiento'],
    getTaskStatus: ['tareas', 'estado', 'plan', 'status'],
    askUser: ['preguntar', 'usuario', 'aclaracion'],
  };
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const plainSchema = (schema: unknown) => {
    try { return schema ? JSON.parse(JSON.stringify(schema)) : null; } catch { return { type: 'object', properties: {}, additionalProperties: true }; }
  };
  const entries = Object.entries(availableTools)
    .filter(([name, definition]) => definition && !['swarm', 'subagent', 'listAvailableTools'].includes(name))
    .map(([name, definition]) => ({
      name,
      description: String(definition.description || 'Sin descripción'),
      keywords: keywordMap[name] || [],
      schema: plainSchema(definition.inputSchema),
    }));
  const definitions = new Map(entries.map((entry) => [entry.name, availableTools[entry.name]]));
  return wrapToolSet({
    searchTools: tool({
      description: 'Search available Codeclub tools and return compact descriptions plus exact input schemas. Use this before executeTool when a capability or parameter is uncertain; never invent tool names or inputs.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Capability or keywords to search. Empty returns all tools.' },
          page: { type: 'number', description: '1-based page number.' },
          pageSize: { type: 'number', description: 'Results per page, maximum 20.' },
        },
        additionalProperties: false,
      }),
      execute: async ({ query, page, pageSize }) => {
        const startedAt = performance.now();
        const normalizedQuery = normalize(String(query || '').trim());
        const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 2 && !['con', 'para', 'que', 'una', 'uno', 'del', 'por'].includes(term));
        const ranked = entries.map((entry) => {
          const haystack = normalize(`${entry.name} ${entry.description} ${entry.keywords.join(' ')}`);
          const score = terms.reduce((total, term) => total + (haystack.includes(term) ? (entry.name.toLowerCase().includes(term) ? 3 : 1) : 0), 0);
          return { entry, score };
        }).filter(({ score }) => !terms.length || score > 0).sort((a, b) => b.score - a.score);
        const matches = ranked.map(({ entry }) => entry);
        const size = Math.min(Math.max(Number(pageSize) || 10, 1), 20);
        const currentPage = Math.max(Number(page) || 1, 1);
        const start = (currentPage - 1) * size;
        return { query: normalizedQuery, page: currentPage, pageSize: size, total: matches.length, hasMore: start + size < matches.length, durationMs: Math.round(performance.now() - startedAt), tools: matches.slice(start, start + size) };
      },
    }),
    executeTool: tool({
      description: 'Execute one tool returned by searchTools using its exact name and schema-compatible input object. Report the real result or error; do not claim success without evidence.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact tool name returned by searchTools.' },
          input: { type: 'object', description: 'Arguments matching the tool schema returned by searchTools.' },
        },
        required: ['name'],
        additionalProperties: false,
      }),
      execute: async ({ name, input }) => {
        const definition = definitions.get(name);
        if (!definition?.execute) return { ok: false, error: `Tool no disponible: ${name}` };
        const startedAt = performance.now();
        try {
          const result = await definition.execute(input || {});
          const nextStep = name === 'computerAction' && input?.action === 'focus'
            ? 'Continuá inmediatamente con computerGetState. Si no devuelve TextBox/Input, ejecutá computerScreenshot o computerOcr; después hacé click con x/y, type y key {ENTER}.'
            : undefined;
          const output = { ok: true, tool: name, durationMs: Math.round(performance.now() - startedAt), result, ...(nextStep ? { nextStep } : {}) };
          recordToolEvent?.('executeTool', { name, input: input || {} }, output);
          return output;
        } catch (error) {
          const output = { ok: false, tool: name, durationMs: Math.round(performance.now() - startedAt), error: String(error) };
          recordToolEvent?.('executeTool', { name, input: input || {} }, output);
          return output;
        }
      },
    }),
  });
}


export type AgentMode = 'development';
export type AgentSpecialist = 'primary' | 'developer' | 'explorer' | 'frontend' | 'backend' | 'qa' | 'security' | 'documentation' | 'computer_use';

export async function resolveAgentRouteWithAI({ prompt }: { model?: any; prompt: string; modeOverride?: 'auto' | AgentMode; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  return { mode: 'development' as const, specialist: inferAgentSpecialist(prompt, 'development'), confidence: 1, reason: 'Desarrollo es el modo único de Codeclub.' };
}

export function inferAgentMode(_prompt: string): AgentMode { return 'development'; }

export function inferAgentSpecialist(prompt: string, _mode: AgentMode): AgentSpecialist {
  const text = prompt.toLowerCase();
  if (/navegador|browser|pc|mouse|teclado|edge|youtube/.test(text)) return 'computer_use';
  if (/test|qa|probar|error|bug|falla/.test(text)) return 'qa';
  if (/ui|ux|diseño|css|componente|interfaz/.test(text)) return 'frontend';
  if (/api|backend|servidor|base de datos/.test(text)) return 'backend';
  if (/document|readme|explicar/.test(text)) return 'documentation';
  return 'developer';
}

export async function resolveToolsWithAI({ toolset, prompt }: { model?: any; mode?: AgentMode; prompt: string; toolset: Record<string, any>; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  return { tools: selectToolsForPrompt(toolset, 'development', prompt), confidence: 1, reason: 'Selección de tools de desarrollo.', requiresAction: false, goal: prompt, verification: 'La tool correspondiente debe devolver un resultado exitoso.' };
}

export async function verifyToolExecutionWithAI({ model, prompt, goal, verification, toolEvents, changes, signal, onUsage }: { model: any; prompt: string; goal: string; verification: string; toolEvents: any[]; changes: any; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  let result: { completed?: boolean; retry?: boolean; reason?: string } | null = null;
  await runStream({
    model,
    system: 'Sos la IA verificadora de Codeclub. Compará el objetivo y el criterio de verificación con las tools realmente ejecutadas, sus resultados y el diff local. No supongas que el texto del agente es evidencia. Para control de PC exigí evidencia observable: proceso, ventana, URL, salida estructurada o estado posterior; un código 0 por sí solo no prueba que una interfaz haya cambiado ni que un video está disponible. Si falta evidencia, el resultado contradice el objetivo o aparece contenido no disponible, indicá retry=true y pedí observar nuevamente antes de repetir acciones. Devolvé JSON estructurado.',
    messages: [{ role: 'user', content: JSON.stringify({ contract: 'VERIFICATION CONTRACT: valida solamente outputs reales. Si falta evidencia, contradice el objetivo o una UI no fue observada despues de actuar, completed=false y retry=true. Nunca conviertas texto del agente, codigo 0 aislado o una intencion en evidencia.', prompt, goal, verification, toolEvents: toolEvents.slice(-20), changes }) }],
    tools: {},
    structuredOutput: undefined,
    signal,
    callbacks: { onTextDelta: () => {}, onStructuredOutput: (output) => { result = output; }, onUsage },
  });
  return result || { completed: false, retry: true, reason: 'La IA verificadora no devolvió resultado.' };
}

export function createTools(ctx: ToolContext) {
  const { projectPath, projectScoped: activeProject = false, recordToolEvent, setAgentState, requestToolApproval, provider, modelId } = ctx;
  type PluginScope = 'global' | 'project';
  const resolvePluginScope = (requested?: string): PluginScope => {
    if (requested === 'global') return 'global';
    if (requested === 'project') return 'project';
    return activeProject ? 'project' : 'global';
  };
  const requirePluginScope = (requested?: string) => {
    const scope = resolvePluginScope(requested);
    if (scope === 'project' && !activeProject) return { error: 'Seleccioná un proyecto para crear una extensión o skill del proyecto.' } as const;
    return { scope } as const;
  };
  const readPluginFile = async (scope: PluginScope, pluginId: string, relativePath: string) => invoke<any>('codeclub_agent_plugin_read_file', { projectPath, scope, pluginId, path: relativePath });
  const writePluginFile = async (scope: PluginScope, pluginId: string, relativePath: string, content: string) => invoke<any>('codeclub_agent_plugin_write_file', { projectPath, scope, pluginId, path: relativePath, content });

  return wrapToolSet({
    ...createSwarmTool({ projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId }),
    listFiles: tool({
      description: 'List project files in the active Codeclub workspace. Skips heavy folders.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          maxFiles: { type: 'number', description: 'Maximum files to return. Default 400.' },
        },
        additionalProperties: false,
      }),
      execute: async ({ maxFiles }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_list_files', {
          projectPath,
          maxFiles: Math.min(Number(maxFiles) || 400, 1200),
        });
        recordToolEvent('listFiles', { maxFiles }, output);
        return output;
      },
    }),
    readFile: tool({
      description: 'Read a UTF-8 text file from the active workspace using a relative path.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
        },
        required: ['path'],
        additionalProperties: false,
      }),
      execute: async ({ path }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_read_file', { projectPath, path });
        recordToolEvent('readFile', { path }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchText: tool({
      description: 'Search exact text in workspace files and return path, line, and preview.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text to search for.' },
          maxMatches: { type: 'number', description: 'Maximum matches. Default 80.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async ({ query, maxMatches }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_search_text', {
          projectPath,
          query,
          maxMatches: Math.min(Number(maxMatches) || 80, 200),
        });
        recordToolEvent('searchText', { query, maxMatches }, output);
        return output;
      },
    }),
    askUser: tool({
      description: 'Request clarification from the user when an important decision is missing. Returns a pending request; it does not answer for the user.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Clear question for the user.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional answer choices.' },
          context: { type: 'string', description: 'Optional reason why the answer is needed.' },
        },
        required: ['question'],
        additionalProperties: false,
      }),
      execute: async ({ question, options, context }) => {
        setAgentState('tool_call');
        const output = { status: 'awaiting_user', question, options: options || [], context: context || null };
        recordToolEvent('askUser', { question, options, context }, output);
        return output;
      },
    }),
    createPlan: tool({
      description: 'Create a persistent implementation plan for the active project. Use for multi-step work and verify the returned plan and step IDs.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Plan title.' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered implementation steps.' },
        },
        required: ['title', 'steps'],
        additionalProperties: false,
      }),
      execute: async ({ title, steps }) => {
        setAgentState('tool_call');
        const now = new Date().toISOString();
        const plan = {
          id: createId('plan'),
          title,
          status: 'pending' as TaskStatus,
          steps: (steps || []).map((step: string) => ({ id: createId('step'), title: step, status: 'pending' as TaskStatus })),
          createdAt: now,
          updatedAt: now,
        };
        const state = await readAgentState(projectPath);
        state.plans = [...(state.plans || (state.plan ? [state.plan] : [])), plan];
        state.plan = plan;
        await writeAgentState(projectPath, state);
        recordToolEvent('createPlan', { title, steps }, plan);
        return plan;
      },
    }),
    updatePlan: tool({
      description: 'Update the active implementation plan or one of its steps. Verify the returned status after persisting the change.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          planId: { type: 'string', description: 'Optional plan ID. Defaults to the active plan.' },
          title: { type: 'string', description: 'Optional new plan title.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
          stepId: { type: 'string', description: 'Optional step ID to update.' },
          stepStatus: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
        },
        additionalProperties: false,
      }),
      execute: async ({ planId, title, status, stepId, stepStatus }) => {
        setAgentState('tool_call');
        const state = await readAgentState(projectPath);
        if (!state.plan || (planId && state.plan.id !== planId)) return { ok: false, error: 'No se encontró el plan indicado.' };
        const plans = state.plans || (state.plan ? [state.plan] : []);
        const target = planId ? plans.find((item) => item.id === planId) : plans[plans.length - 1];
        if (!target) return { ok: false, error: 'No se encontró el plan indicado.' };
        if (title) target.title = title;
        if (status) target.status = status as TaskStatus;
        if (stepId && stepStatus) {
          const step = target.steps.find((item) => item.id === stepId);
          if (!step) return { ok: false, error: 'No se encontró el paso indicado.' };
          step.status = stepStatus as TaskStatus;
        }
        target.updatedAt = new Date().toISOString();
        state.plans = plans;
        state.plan = target;
        await writeAgentState(projectPath, state);
        recordToolEvent('updatePlan', { planId, title, status, stepId, stepStatus }, target);
        return target;
      },
    }),
    todo: tool({
      description: 'Manage persistent TODO items for the active project. Verify the returned TODO list after add, update, remove or clear actions.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove', 'clear', 'list'] },
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
        },
        required: ['action'],
        additionalProperties: false,
      }),
      execute: async ({ action, id, title, description, status }) => {
        setAgentState('tool_call');
        const state = await readAgentState(projectPath);
        if (action === 'add' && title) {
          const now = new Date().toISOString();
          state.todos.push({ id: createId('todo'), title, description, status: (status || 'pending') as TaskStatus, createdAt: now, updatedAt: now });
        } else if (action === 'update' && id) {
          const todo = state.todos.find((item) => item.id === id);
          if (!todo) return { ok: false, error: 'No se encontró el TODO indicado.' };
          if (title) todo.title = title;
          if (description !== undefined) todo.description = description;
          if (status) todo.status = status as TaskStatus;
          todo.updatedAt = new Date().toISOString();
        } else if (action === 'remove' && id) {
          state.todos = state.todos.filter((item) => item.id !== id);
        } else if (action === 'clear') {
          state.todos = [];
        }
        await writeAgentState(projectPath, state);
        const output = { ok: true, todos: state.todos };
        recordToolEvent('todo', { action, id, title, description, status }, output);
        return output;
      },
    }),
    getTaskStatus: tool({
      description: 'Read the current implementation plan and TODO items for the active project. Use this to verify persisted planning state without modifying it.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        setAgentState('tool_call');
        const state = await readAgentState(projectPath);
        recordToolEvent('getTaskStatus', {}, state);
        return state;
      },
    }),
    getExecutionLog: tool({
      description: 'Read the structured execution log for the active project: tools used, inputs, outputs and timestamps. Use it to inspect delegated work without relying on private chain-of-thought.',
      inputSchema: jsonSchema({ type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false }),
      execute: async ({ limit }) => {
        setAgentState('tool_call');
        const output = await readExecutionLog(projectPath, limit);
        recordToolEvent('getExecutionLog', { limit }, output);
        return output;
      },
    }),
    writeFile: tool({
      description: 'Write full UTF-8 content to a relative workspace file inside the active workspace. After writing, verify the real file with readFile or listFiles.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
          content: { type: 'string', description: 'Complete file content to write.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      }),
      execute: async ({ path, content }) => {
        setAgentState('running');
        await invoke('codeclub_write_file', { projectPath, path, content });
        const output = { ok: true, path, workspace: projectPath };
        recordToolEvent('writeFile', { path }, output);
        return output;
      },
    }),
    createSkill: tool({
      description: 'Create a complete Agent Plugins package globally or in the active project, including plugin.json and skills/<skillName>/SKILL.md.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plugin name in lowercase kebab/dot format.' },
          skillName: { type: 'string', description: 'Optional skill name. Defaults to the plugin name.' },
          description: { type: 'string', description: 'Plugin and skill description.' },
          instructions: { type: 'string', description: 'Complete Markdown instructions for the skill.' },
          version: { type: 'string', description: 'Optional plugin version.' },
          author: { type: 'string', description: 'Optional author name.' },
          license: { type: 'string', description: 'Optional SPDX license identifier.' },
          homepage: { type: 'string', description: 'Optional plugin homepage URL.' },
          scope: { type: 'string', enum: ['global', 'project'], description: 'Where to install it. Defaults to project when one is active, otherwise global.' },
        },
        required: ['name', 'description', 'instructions'],
        additionalProperties: false,
      }),
      execute: async ({ name, skillName: requestedSkillNameInput, description, instructions, version, author, license, homepage, scope: requestedScope }) => {
        setAgentState('running');
        // El alcance se valida con requirePluginScope; un plugin global no necesita proyecto.
        const scopeResult = requirePluginScope(requestedScope);
        if ('error' in scopeResult) return { ok: false, error: scopeResult.error };
        const scope = scopeResult.scope;
        const pluginName = String(name || '').trim().toLowerCase();
        const pluginSkillName = String(requestedSkillNameInput || pluginName).trim().toLowerCase();
        const pluginDescription = String(description || '').trim().replace(/[\r\n]+/g, ' ');
        const pluginInstructions = String(instructions || '').trim();
        if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(pluginName) || pluginName.length > 64 || pluginName.includes('--') || pluginName.includes('..')) return { ok: false, error: 'El nombre del plugin debe usar minúsculas, números, guiones o puntos.' };
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginSkillName) || pluginSkillName.length > 64 || pluginSkillName.includes('--')) return { ok: false, error: 'El nombre de la skill debe usar kebab-case.' };
        if (!pluginDescription || pluginDescription.length > 1024) return { ok: false, error: 'La descripción debe tener entre 1 y 1024 caracteres.' };
        if (!pluginInstructions || pluginInstructions.length > 180000) return { ok: false, error: 'Las instrucciones deben tener entre 1 y 180000 caracteres.' };
        const pluginPath = scope === 'project' ? `project/plugins/${pluginName}` : `global/plugins/${pluginName}`;
        const manifestPath = `${pluginPath}/plugin.json`;
        const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
        let manifest: any = { '$schema': schema, name: pluginName };
        try { manifest = JSON.parse(String((await readPluginFile(scope, pluginName, 'plugin.json')).content)); } catch { /* paquete nuevo */ }
        if (manifest.name !== pluginName || manifest['$schema'] !== schema) return { ok: false, error: 'El plugin existente tiene un manifest incompatible.' };
        manifest.version = String(version || manifest.version || '0.1.0');
        manifest.description = String(manifest.description || pluginDescription);
        if (author) manifest.author = { name: String(author).trim().slice(0, 200) };
        if (license) manifest.license = String(license).trim().slice(0, 80);
        if (homepage) manifest.homepage = String(homepage).trim().slice(0, 500);
        const pluginSkillContent = `---\nname: ${pluginSkillName}\ndescription: ${pluginDescription}\n---\n\n${pluginInstructions}\n`;
        await writePluginFile(scope, pluginName, 'plugin.json', JSON.stringify(manifest, null, 2) + '\n');
        await writePluginFile(scope, pluginName, `skills/${pluginSkillName}/SKILL.md`, pluginSkillContent);
        const pluginOutput = { ok: true, plugin: pluginName, pluginPath, manifestPath, skillName: pluginSkillName, skillPath: `${pluginPath}/skills/${pluginSkillName}/SKILL.md`, scope, workspace: scope === 'project' ? projectPath : null, availableInSession: true, format: 'agent-plugins-1.0.0' };
        recordToolEvent('createSkill', { name: pluginName, skillName: pluginSkillName, description: pluginDescription, pluginPath }, pluginOutput);
        window.dispatchEvent(new CustomEvent('codeclub:skills-changed', { detail: { projectPath, pluginName, skillName: pluginSkillName } }));
        return pluginOutput;
      },
    }),
    createExtension: tool({
      description: 'Create a complete Agent Plugins package with one skill. Agent Plugins is the canonical format for new extensions.',
      inputSchema: jsonSchema({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] } }, required: ['name', 'description', 'instructions'], additionalProperties: false }),
      execute: async ({ name, description, instructions, scope: requestedScope }) => {
        setAgentState('running');
        const scopeResult = requirePluginScope(requestedScope);
        if ('error' in scopeResult) return { ok: false, error: scopeResult.error };
        const scope = scopeResult.scope;
        const pluginName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
        const pluginDescription = String(description || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 1024);
        const pluginInstructions = String(instructions || '').trim();
        if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(pluginName) || !pluginDescription || !pluginInstructions) return { ok: false, error: 'El plugin requiere nombre, descripción e instrucciones válidas.' };
        const pluginPath = scope === 'project' ? `project/plugins/${pluginName}` : `global/plugins/${pluginName}`;
        const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
        const manifest = { '$schema': schema, name: pluginName, version: '0.1.0', description: pluginDescription };
        const skillContent = `---\nname: ${pluginName}\ndescription: ${pluginDescription}\n---\n\n${pluginInstructions}\n`;
        await writePluginFile(scope, pluginName, 'plugin.json', JSON.stringify(manifest, null, 2) + '\n');
        await writePluginFile(scope, pluginName, `skills/${pluginName}/SKILL.md`, skillContent);
        const pluginOutput = { ok: true, plugin: pluginName, pluginPath, scope, workspace: scope === 'project' ? projectPath : null, format: 'agent-plugins-1.0.0', availableInSession: true };
        recordToolEvent('createExtension', { name: pluginName, description: pluginDescription }, pluginOutput);
        window.dispatchEvent(new CustomEvent('codeclub:skills-changed', { detail: { projectPath, pluginName } }));
        return pluginOutput;
      },
    }),
    deleteExtension: tool({
      description: 'Delete an Agent Plugins package from global scope or the active project.',
      inputSchema: jsonSchema({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] } }, additionalProperties: false }),
      execute: async ({ id, name, scope: requestedScope }) => {
        setAgentState('running');
        const scopeResult = requirePluginScope(requestedScope);
        if ('error' in scopeResult) return { ok: false, error: scopeResult.error };
        const scope = scopeResult.scope;
        const pluginId = String(id || name || '').replace(/^custom-/, '').trim().toLowerCase();
        if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(pluginId)) return { ok: false, error: 'Indicá el nombre válido del plugin.' };
        try { await invoke('codeclub_delete_agent_plugin', { projectPath, pluginId, scope }); } catch (error) { return { ok: false, error: String(error) }; }
        const pluginOutput = { ok: true, deleted: pluginId, scope, format: 'agent-plugins-1.0.0' };
        recordToolEvent('deleteExtension', { id, name, pluginId }, pluginOutput);
        window.dispatchEvent(new CustomEvent('codeclub:skills-changed', { detail: { projectPath, pluginId } }));
        return pluginOutput;
      },
    }),
    createMcpServer: tool({
      description: 'Create a complete Agent Plugins package containing an MCP server globally or in the active project.',
      inputSchema: jsonSchema({ type: 'object', properties: { name: { type: 'string', description: 'MCP server display name.' }, pluginName: { type: 'string', description: 'Optional Agent Plugin name.' }, type: { type: 'string', enum: ['stdio', 'streamable-http', 'sse'] }, url: { type: 'string' }, command: { type: 'string', description: 'Executable token for stdio.' }, args: { type: 'array', items: { type: 'string' } }, env: { type: 'object', additionalProperties: { type: 'string' } }, cwd: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] } }, required: ['name'], additionalProperties: false }),
      execute: async ({ name, pluginName, url, type, command, args, env, cwd, scope: requestedScope }) => {
        setAgentState('running');
        const scopeResult = requirePluginScope(requestedScope);
        if ('error' in scopeResult) return { ok: false, error: scopeResult.error };
        const scope = scopeResult.scope;
        let cleanUrl = 'https://stdio.invalid';
        const serverName = String(name || 'server').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'server';
        const mcpPluginName = String(pluginName || `mcp-${serverName}`).trim().toLowerCase();
        const transport = type || (command ? 'stdio' : 'streamable-http');
        if (!['stdio', 'streamable-http', 'sse'].includes(transport)) return { ok: false, error: 'Transporte MCP no soportado.' };
        let serverConfig: any;
        if (transport === 'stdio') {
          const executable = String(command || '').trim();
          const serverArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
          const serverEnv = env && typeof env === 'object' ? Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])) : {};
          const serverCwd = cwd === undefined ? undefined : String(cwd).trim();
          if (!executable || /\s/.test(executable) || executable.includes('..')) return { ok: false, error: 'stdio requiere command como un único token seguro.' };
          if (Object.keys(serverEnv).some((key) => key === 'PLUGIN_ROOT' || key === 'PLUGIN_DATA')) return { ok: false, error: 'PLUGIN_ROOT y PLUGIN_DATA son variables reservadas.' };
          if (serverCwd && ((!serverCwd.startsWith('./') && !serverCwd.startsWith('${PLUGIN_ROOT}') && !serverCwd.startsWith('${PLUGIN_DATA}')) || serverCwd.includes('..'))) return { ok: false, error: 'cwd debe usar ./, PLUGIN_ROOT o PLUGIN_DATA sin escapar.' };
          serverConfig = { type: 'stdio', command: executable, ...(serverArgs.length ? { args: serverArgs } : {}), ...(Object.keys(serverEnv).length ? { env: serverEnv } : {}), ...(serverCwd ? { cwd: serverCwd } : {}) };
        } else {
          cleanUrl = String(url || '').trim();
          if (!/^https:\/\/\S+$/i.test(cleanUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/\S*)?$/i.test(cleanUrl)) return { ok: false, error: 'El endpoint MCP debe usar HTTPS; HTTP solo está permitido para loopback.' };
          serverConfig = { type: transport === 'sse' ? 'sse' : 'streamable-http', url: cleanUrl };
        }
        if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(mcpPluginName) || mcpPluginName.length > 64 || mcpPluginName.includes('--') || mcpPluginName.includes('..')) return { ok: false, error: 'El nombre del plugin debe usar minúsculas, números, guiones o puntos.' };
        if (!/^https:\/\/\S+$/i.test(cleanUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/\S*)?$/i.test(cleanUrl)) return { ok: false, error: 'El endpoint MCP debe usar HTTPS; HTTP solo está permitido para loopback.' };
        const pluginPath = scope === 'project' ? `project/plugins/${mcpPluginName}` : `global/plugins/${mcpPluginName}`;
        const manifest = { '$schema': 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: mcpPluginName, version: '0.1.0', description: `MCP server ${serverName}` };
        const mcpConfig = { '$schema': 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { [serverName]: serverConfig } };
        await writePluginFile(scope, mcpPluginName, 'plugin.json', JSON.stringify(manifest, null, 2) + '\n');
        await writePluginFile(scope, mcpPluginName, 'mcp.json', JSON.stringify(mcpConfig, null, 2) + '\n');
        const pluginServer = { ok: true, plugin: mcpPluginName, pluginPath, scope, workspace: scope === 'project' ? projectPath : null, serverName, ...serverConfig, format: 'agent-plugins-1.0.0', availableNextMessage: true };
        recordToolEvent('createMcpServer', { name, pluginName: mcpPluginName, ...serverConfig }, pluginServer);
        window.dispatchEvent(new CustomEvent('codeclub:mcp-changed', { detail: { projectPath, pluginName: mcpPluginName } }));
        return pluginServer;
      },
    }),
    deleteMcpServer: tool({
      description: 'Delete an Agent Plugins MCP package globally or from the active project.',
      inputSchema: jsonSchema({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] } }, additionalProperties: false }),
      execute: async ({ id, name, url, scope: requestedScope }) => {
        setAgentState('running');
        const scopeResult = requirePluginScope(requestedScope);
        if ('error' in scopeResult) return { ok: false, error: scopeResult.error };
        const scope = scopeResult.scope;
        const pluginId = String(id || name || '').trim().toLowerCase();
        if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(pluginId)) return { ok: false, error: 'Indicá el nombre válido del plugin MCP.' };
        try { await invoke('codeclub_delete_agent_plugin', { projectPath, pluginId, scope }); } catch (error) { return { ok: false, error: String(error) }; }
        const pluginOutput = { ok: true, deleted: pluginId, scope, format: 'agent-plugins-1.0.0' };
        recordToolEvent('deleteMcpServer', { id, name, url, pluginId }, pluginOutput);
        window.dispatchEvent(new CustomEvent('codeclub:mcp-changed', { detail: { projectPath, pluginId } }));
        return pluginOutput;
      },
    }),
    runCommand: tool({
      description: 'Run any command in the active workspace without confirmation.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Any executable command available on the system.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
          cwd: { type: 'string', description: 'Optional working directory. Relative paths resolve inside the active workspace; omit to use the workspace root.' },
        },
        required: ['command', 'args'],
        additionalProperties: false,
      }),
      execute: async ({ command, args, cwd }) => {
        setAgentState('running');
        const output = await invoke('codeclub_run_command', {
          projectPath,
          request: { command, args: Array.isArray(args) ? args : [], cwd: cwd || null },
        });
        recordToolEvent('runCommand', { command, args, cwd: cwd || null }, output);
        return output;
      },
    }),
    terminal: tool({
      description: 'Create a persistent background terminal process and optionally send any command without confirmation. It does not open a visible UI tab.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          shell: {
            type: 'string',
            enum: ['auto', 'powershell', 'git-bash', 'wsl', 'cmd'],
            description: 'Terminal shell to start. Defaults to auto.',
          },
          command: {
            type: 'string',
            description: 'Optional command to type into the background terminal.',
          },
          name: {
            type: 'string',
            description: 'Optional process label for internal tracking.',
          },
        },
        additionalProperties: false,
      }),
      execute: async ({ shell, command, name }) => {
        setAgentState('running');
        const terminal = await invoke<any>('codeclub_terminal_create', {
          request: {
            projectPath,
            shell: shell || 'auto',
            name: name || 'Background',
            isAgent: true,
          },
        });

        if (command) {
          const text = String(command).endsWith('\n') ? String(command) : `${command}\n`;
          await invoke('codeclub_terminal_write', { id: terminal.id, data: text });
        }

        const output = {
          ok: true,
          id: terminal.id,
          shell: terminal.shell,
          background: true,
          commandSent: Boolean(command),
        };
        recordToolEvent('terminal', { shell, command, name }, output);
        return output;
      },
    }),
    openBrowser: tool({
      description: 'Open a web URL in Codeclub\'s Browser tab so the user can inspect it and reference the page or selected text in chat.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http or https URL to open.' } },
        required: ['url'],
        additionalProperties: false,
      }),
      execute: async ({ url }) => {
        const normalized = normalizeBrowserUrl(url);
        if (!normalized) {
          const output = { ok: false, error: 'URL inválida. Usá una dirección http(s) con puerto válido.' };
          recordToolEvent('openBrowser', { url }, output);
          return output;
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
          window.dispatchEvent(new CustomEvent('codeclub:browser-navigate', { detail: { url: normalized } }));
        }
        const output = { ok: true, url: normalized, openedIn: 'Navegador' };
        recordToolEvent('openBrowser', { url: normalized }, output);
        return output;
      },
    }),
    getBrowserState: tool({
      description: 'Inspect the active Codeclub browser without vision. Returns accessible DOM text, visible controls, roles, labels, selectors and screen rectangles as JSON.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        if (typeof window === 'undefined') return { ok: false, error: 'El navegador solo está disponible en la aplicación.' };
        const output = await new Promise<any>((resolve) => {
          let timer: number | undefined;
          const cleanup = () => { if (timer) window.clearTimeout(timer); window.removeEventListener('codeclub:browser-state', handleState); };
          const handleState = (event: Event) => { cleanup(); resolve({ ok: true, state: (event as CustomEvent).detail }); };
          window.addEventListener('codeclub:browser-state', handleState, { once: true });
          timer = window.setTimeout(() => { cleanup(); resolve({ ok: false, error: 'No se recibió el estado del navegador.' }); }, 5000);
          window.dispatchEvent(new CustomEvent('codeclub:browser-state-request'));
        });
        recordToolEvent('getBrowserState', {}, output);
        return output;
      },
    }),
    browserAction: tool({
      description: 'Interact with the active browser using a selector from getBrowserState. Supports move, click, type, key and scroll; does not require model vision.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['move', 'click', 'type', 'key', 'scroll'] },
          selector: { type: 'string', description: 'CSS selector returned by getBrowserState. Omit only for scroll.' },
          text: { type: 'string' },
          key: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['type'],
        additionalProperties: false,
      }),
      execute: async (action) => {
        if (typeof window === 'undefined') return { ok: false, error: 'El navegador solo está disponible en la aplicación.' };
        const output = await new Promise<any>((resolve) => {
          let timer: number | undefined;
          const cleanup = () => { if (timer) window.clearTimeout(timer); window.removeEventListener('codeclub:browser-action-result', handleResult); };
          const handleResult = (event: Event) => { cleanup(); resolve((event as CustomEvent).detail || { ok: false, error: 'Resultado vacíoo.' }); };
          window.addEventListener('codeclub:browser-action-result', handleResult, { once: true });
          timer = window.setTimeout(() => { cleanup(); resolve({ ok: false, error: 'No se recibió confirmación de la acción.' }); }, 5000);
          window.dispatchEvent(new CustomEvent('codeclub:browser-action', { detail: action }));
        });
        recordToolEvent('browserAction', action, output);
        return output;
      },
    }),
    computerListWindows: tool({
      description: 'List visible top-level Windows applications with title, class and screen bounds. Read-only; use it before controlling another app.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const output = await invoke('codeclub_computer_list_windows');
        recordToolEvent('computerListWindows', {}, output);
        return output;
      },
    }),
    computerGetState: tool({
      description: 'Inspect the focused Windows app through UI Automation. If it only exposes a Pane or no TextBox/Input, immediately use computerScreenshot and continue with coordinates; do not wait for inaccessible controls.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const output = await invoke('codeclub_computer_get_state');
        recordToolEvent('computerGetState', {}, output);
        return output;
      },
    }),
    computerScreenshot: tool({
      description: 'Capture the current Windows desktop as PNG evidence. Read-only; use it before and after computer actions.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const output = await invoke('codeclub_computer_screenshot');
        recordToolEvent('computerScreenshot', {}, { ok: true, width: (output as any).width, height: (output as any).height });
        return output;
      },
    }),
    computerOcr: tool({
      description: 'Run local OCR over the current Windows desktop screenshot. Returns recognized text, confidence and word bounding boxes in screen coordinates for models without vision.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const screenshot = await invoke<any>('codeclub_computer_screenshot');
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng+spa');
        try {
          const image = `data:${screenshot.mimeType};base64,${screenshot.data}`;
          const result = await worker.recognize(image);
          const words = (((result.data as any).words || []) as any[]).map((word: any) => ({
            text: word.text,
            confidence: word.confidence,
            bounds: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 },
          }));
          const output = { ok: true, text: result.data.text, confidence: result.data.confidence, words, width: screenshot.width, height: screenshot.height };
          recordToolEvent('computerOcr', {}, { ok: true, confidence: output.confidence, words: words.length, width: output.width, height: output.height });
          return output;
        } finally {
          await worker.terminate();
        }
      },
    }),
    computerAction: tool({
      description: 'Control a visible Windows app with the mouse or keyboard. For a desktop app, first use focus with targetName (for example ChatGPT), then inspect its state. If no input is accessible, use screenshot coordinates: click x/y, then type text, then key {ENTER}. Do not use openBrowser for desktop apps. Actions: focus, move, click, doubleClick, rightClick, type, key.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['focus', 'move', 'click', 'doubleClick', 'rightClick', 'type', 'key'] },
          x: { type: 'number' },
          y: { type: 'number' },
          text: { type: 'string' },
          key: { type: 'string', description: 'Key expression, e.g. {CTRL}L or {ENTER}.' },
          targetName: { type: 'string', description: 'Accessible control name from computerGetState.' },
          automationId: { type: 'string', description: 'Automation id from computerGetState.' },
        },
        required: ['action'],
        additionalProperties: false,
      }),
      execute: async (request) => {
        if (false) {
          const approved = await requestToolApproval({ toolName: 'computerAction', input: request, summary: `Controlar Windows: ${request.action}` });
          if (!approved) return { ok: false, error: 'Acción cancelada por el usuario.' };
        }
        const output = await invoke('codeclub_computer_action', { request });
        recordToolEvent('computerAction', request, output);
        return { ok: true, action: request.action, result: output };
      },
    }),
    switchProject: tool({
      description: 'Switch the active workspace project, or select no project. Accepts an indexed project name or full path.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Indexed project name or full path. Use "Sin proyecto" to clear the active project.' },
        },
        required: ['project'],
        additionalProperties: false,
      }),
      execute: async ({ project }) => {
        const requested = String(project || '').trim();
        const normalizedRequested = requested.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (!requested || normalizedRequested === 'sin proyecto' || normalizedRequested === 'ninguno') {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: false, keepChat: true, projectPath: null, projectName: 'Sin proyecto' } }));
            window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: null, projectName: 'Sin proyecto' } }));
          }
          return { ok: true, project: null, projectName: 'Sin proyecto' };
        }
        const projects = await readProjectIndex();
        const match = projects.find((entry) => entry.path === requested || entry.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalizedRequested);
        if (!match) return { ok: false, error: `No encontré un proyecto indexado llamado o ubicado en: ${requested}`, availableProjects: projects.map((entry) => ({ name: entry.name, path: entry.path })) };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('codeclub:project-selection-changed', { detail: { selected: true, projectPath: match.path, projectName: match.name } }));
          window.dispatchEvent(new CustomEvent('codeclub:active-project', { detail: { projectPath: match.path, projectName: match.name } }));
        }
        return { ok: true, project: match.path, projectName: match.name };
      },
    }),
    subagent: tool({
      description: 'Delegate a focused development or computer-control task to a specialist IA. For browser or PC work, provide explicit tools and require observable state before and after actions.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          specialist: { type: 'string', enum: ['developer', 'explorer', 'frontend', 'backend', 'qa', 'security', 'documentation', 'computer_use'] },
          task: { type: 'string', maxLength: 500, description: 'English handoff, maximum 500 characters.' },
        },
        required: ['specialist', 'task'],
        additionalProperties: false,
      }),
      execute: async ({ specialist, task: rawTask }) => {
        if (!provider || !modelId) {
          return { error: 'No provider/model configured for subagent.' };
        }
        setAgentState('tool_call');
        const task = specialistHandoff(rawTask);
        recordToolEvent('subagent', { specialist, task }, { status: 'running' });

        const developmentTools = createTools({ projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId });
        const indexedTools = developmentTools as Record<string, any>;
        const subTools = specialist === 'developer'
          ? Object.fromEntries(['listFiles', 'readFile', 'searchText', 'writeFile', 'runCommand', 'terminal'].map((name) => [name, indexedTools[name]]).filter(([, toolDefinition]) => toolDefinition))
          : specialist === 'computer_use'
            ? Object.fromEntries(['computerListWindows', 'computerGetState', 'computerScreenshot', 'computerOcr', 'computerAction', 'openBrowser', 'getBrowserState', 'browserAction', 'runCommand'].map((name) => [name, indexedTools[name]]).filter(([, toolDefinition]) => toolDefinition))
            : createSubagentTools({ projectPath, recordToolEvent, setAgentState });

        const specialistSystem = specialist === 'computer_use'
          ? 'Sos la subIA Computer Use de Codeclub. Controlas navegador y PC, no editas codigo. Ejecuta primero una tool real, sin narrar planes. Usa el ciclo observar-actuar-verificar: para navegador, getBrowserState antes de browserAction y volve a observar despues; para PC, runCommand debe devolver evidencia estructurada de procesos, ventanas, URL y estado. No repitas ciegamente, no escribas scripts en el chat y no declares exito sin evidencia. Si algo falla, razona una alternativa y ejecuta el siguiente paso.'
          : 'Sos un agente de investigacion de Codeclub. Explora el codigo y responde en espanol. Cuando termines, escribe un resumen claro de tus hallazgos.';

        const result = await runStream({
          model: provider(modelId),
          system: specialistSystem,
          messages: [{ role: 'user', content: task }],
          tools: subTools,
          callbacks: {
            onTextDelta: () => {},
            onUsage: (usage) => persistSubagentUsage(projectPath, modelId, `development-${specialist}`, usage),
          },
        });

        const resultHandoff = specialistHandoff(result);
        recordToolEvent('subagent', { specialist, task }, { result: resultHandoff });
        return resultHandoff;
      },
    }),
  });
}

export function createParentTools(ctx: ToolContext & { availableTools: Record<string, any>; artifactTools: Record<string, any>; projectScoped?: boolean }) {
  const { projectPath, projectScoped, recordToolEvent, setAgentState, requestToolApproval, provider, modelId, availableTools, artifactTools } = ctx;
  return wrapToolSet({
    ...createSwarmTool({ projectPath, projectScoped, recordToolEvent, setAgentState, requestToolApproval, childTools: availableTools, provider, modelId }),
    ...artifactTools,
    listAvailableTools: tool({
      description: 'List every operational tool that the parent can assign to children. The parent cannot execute these tools directly.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const output = { tools: Object.keys(availableTools), parentTools: Object.keys(artifactTools), templates: ['read_only', 'developer', 'custom'] };
        recordToolEvent('listAvailableTools', {}, output);
        return output;
      },
    }),
  });
}
