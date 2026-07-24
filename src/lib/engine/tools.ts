import { invoke } from '@tauri-apps/api/core';
import { jsonSchema, Output, tool } from 'ai';
import type { ToolContext } from './types';
import { runStream } from './run';
import { saveMemory, searchMemory, deleteMemory } from './memory';
import { createId, readAgentState, writeAgentState, type TaskStatus } from './planning';
import { ensureBusinessWorkspace, readBusinessWorkspace, writeBusinessWorkspace } from '../projectManager';
import { appendGenerationUsage, readGenerationUsage, summarizeGenerationUsage } from '../usage';
import { readExecutionLog } from '../execution-log';
import { whatsappContextStore } from '../store';

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
  return {
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
  };
}

const businessSpecialistTools = (projectPath: string, recordToolEvent: (name: string, input: any, output: any) => void, setAgentState: (state: string) => void) => ({
  ...createSubagentTools({ projectPath, recordToolEvent, setAgentState }),
  getBusinessWorkspace: tool({
    description: 'Read the active project business workspace.',
    inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
    execute: async () => {
      setAgentState('tool_call');
      const output = await readBusinessWorkspace(projectPath);
      recordToolEvent('specialist.getBusinessWorkspace', {}, output || { status: 'empty' });
      return output || { status: 'empty' };
    },
  }),
  getWhatsAppBusinessContext: tool({
    description: 'Read current WhatsApp conversations and recent messages. Read-only.',
    inputSchema: jsonSchema({ type: 'object', properties: { chatId: { type: 'string' }, maxMessages: { type: 'number' } }, additionalProperties: false }),
    execute: async ({ chatId, maxMessages }) => {
      setAgentState('tool_call');
      const snapshot = whatsappContextStore.get();
      const chats = chatId ? snapshot.chats.filter((chat) => chat.id === chatId) : snapshot.chats;
      const limit = Math.min(Number(maxMessages) || 40, 100);
      const messages = Object.fromEntries((chatId ? [chatId] : chats.map((chat) => chat.id)).map((id) => [id, (snapshot.messages[id] || []).slice(-limit)]));
      const output = { connected: snapshot.connected, account: snapshot.account || null, chats, messages, readOnly: true };
      recordToolEvent('specialist.getWhatsAppBusinessContext', { chatId }, { chats: chats.length });
      return output;
    },
  }),
});

export function createBusinessTools(ctx: { recordToolEvent: (name: string, input: any, output: any) => void; setAgentState: (state: string) => void; indexedProjects: Array<{ name: string; path: string }>; projectPath: string; provider?: any; modelId?: string }) {
  const { recordToolEvent, setAgentState, indexedProjects, projectPath, provider, modelId } = ctx;
  return {
    listProjectFiles: tool({
      description: 'List project files for business context. Read-only; skips heavy folders.',
      inputSchema: jsonSchema({ type: 'object', properties: { maxFiles: { type: 'number' } }, additionalProperties: false }),
      execute: async ({ maxFiles }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_list_files', { projectPath, maxFiles: Math.min(Number(maxFiles) || 400, 1200) });
        recordToolEvent('listProjectFiles', { maxFiles }, output);
        return output;
      },
    }),
    readProjectFile: tool({
      description: 'Read a UTF-8 project file for business analysis. Read-only; never modifies it.',
      inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }),
      execute: async ({ path }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_read_file', { projectPath, path });
        recordToolEvent('readProjectFile', { path }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchProjectText: tool({
      description: 'Search project code and documentation for business context. Read-only.',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' }, maxMatches: { type: 'number' } }, required: ['query'], additionalProperties: false }),
      execute: async ({ query, maxMatches }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_search_text', { projectPath, query, maxMatches: Math.min(Number(maxMatches) || 80, 200) });
        recordToolEvent('searchProjectText', { query, maxMatches }, output);
        return output;
      },
    }),
    listIndexedProjects: tool({
      description: 'List the projects indexed in Codeclub for business context.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        setAgentState('tool_call');
        const output = indexedProjects;
        recordToolEvent('listIndexedProjects', {}, output);
        return output;
      },
    }),
    getBusinessWorkspace: tool({
      description: 'Read the business and economy workspace of the active project.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        setAgentState('tool_call');
        const output = await readBusinessWorkspace(projectPath);
        recordToolEvent('getBusinessWorkspace', {}, output || { status: 'empty' });
        return output || { status: 'empty', message: 'El proyecto todavía no tiene datos comerciales.' };
      },
    }),
    getAIUsageMetrics: tool({
      description: 'Read local AI generation usage for this project and summarize tokens, duration and estimated provider cost for an optional date range.',
      inputSchema: jsonSchema({ type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD.' }, to: { type: 'string', description: 'End date YYYY-MM-DD.' } }, additionalProperties: false }),
      execute: async ({ from, to }) => {
        setAgentState('tool_call');
        const output = summarizeGenerationUsage(await readGenerationUsage(projectPath), from, to);
        recordToolEvent('getAIUsageMetrics', { from, to }, output);
        return output;
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
    updateBusinessWorkspace: tool({
      description: 'Update one business workspace section. Use for project status, monthly fees, quotes, milestones, payments, clients, pricing, opportunities, estimates, time entries, expenses, invoices or notes.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['project', 'profile', 'pricing', 'opportunities', 'estimates', 'quotes', 'milestones', 'payments', 'time_entries', 'expenses', 'invoices', 'notes'] },
          data: { description: 'Complete replacement value for the selected section.' },
        },
        required: ['section', 'data'],
        additionalProperties: false,
      }),
      execute: async ({ section, data }) => {
        setAgentState('tool_call');
        const current = await ensureBusinessWorkspace(projectPath);
        const next = await writeBusinessWorkspace(projectPath, { ...current, [section]: data });
        recordToolEvent('updateBusinessWorkspace', { section, data }, next);
        return next;
      },
    }),
    createQuote: tool({
      description: 'Create and persist a project quotation with a description and line items. Use this tool in Economy mode when the user asks for a quote, estimate or proposal; do not only describe it in text.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          currency: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: 'number' } }, required: ['description', 'quantity', 'unitPrice'], additionalProperties: false } },
          status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected'] },
        },
        required: ['title', 'description', 'items'],
        additionalProperties: false,
      }),
      execute: async ({ title, description, currency, items, status }) => {
        setAgentState('tool_call');
        const current = await ensureBusinessWorkspace(projectPath);
        const normalizedItems = (items || []).map((item) => ({ description: item.description, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0), total: Number(item.quantity || 0) * Number(item.unitPrice || 0) }));
        const quote = { id: createId('quote'), title, description, currency: currency || current.currency || 'USD', items: normalizedItems, total: normalizedItems.reduce((sum, item) => sum + item.total, 0), status: status || 'draft', createdAt: new Date().toISOString() };
        const next = await writeBusinessWorkspace(projectPath, { ...current, quotes: [...(current.quotes || []), quote] });
        recordToolEvent('createQuote', { title, description, currency, items, status }, quote);
        return { ok: true, quote, workspace: next };
      },
    }),
    getWhatsAppBusinessContext: tool({
      description: 'Read the current WhatsApp chats and recent messages for commercial analysis. This tool is read-only and cannot send messages.',
      inputSchema: jsonSchema({ type: 'object', properties: { chatId: { type: 'string' }, maxMessages: { type: 'number' } }, additionalProperties: false }),
      execute: async ({ chatId, maxMessages }) => {
        setAgentState('tool_call');
        const snapshot = whatsappContextStore.get();
        const limit = Math.min(Number(maxMessages) || 40, 100);
        const chats = chatId ? snapshot.chats.filter((chat) => chat.id === chatId) : snapshot.chats;
        const messages = Object.fromEntries((chatId ? [chatId] : chats.map((chat) => chat.id)).map((id) => [id, (snapshot.messages[id] || []).slice(-limit)]));
        const output = { connected: snapshot.connected, account: snapshot.account || null, chats, messages, readOnly: true };
        recordToolEvent('getWhatsAppBusinessContext', { chatId, maxMessages: limit }, { connected: output.connected, chats: chats.length });
        return output;
      },
    }),
    createExecutionPlan: tool({
      description: 'Create a structured execution plan for a business initiative.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'objective', 'steps'],
        additionalProperties: false,
      }),
      execute: async ({ title, objective, steps }) => {
        setAgentState('tool_call');
        const output = { type: 'execution_plan', title, objective, steps, status: 'draft', createdAt: new Date().toISOString() };
        recordToolEvent('createExecutionPlan', { title, objective, steps }, output);
        return output;
      },
    }),
    createBudget: tool({
      description: 'Calculate a business budget from line items.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          currency: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name', 'amount'], additionalProperties: false } },
        },
        required: ['items'],
        additionalProperties: false,
      }),
      execute: async ({ currency, items }) => {
        setAgentState('tool_call');
        const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const output = { type: 'budget', currency: currency || 'USD', items, total };
        recordToolEvent('createBudget', { currency, items }, output);
        return output;
      },
    }),
    delegateBusinessSpecialist: tool({
      description: 'Delegate a focused business investigation to a specialist IA. It can read project code, business data and WhatsApp, but cannot edit or send messages.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          specialist: { type: 'string', enum: ['commercial', 'pricing', 'finance', 'operations', 'crm_whatsapp', 'strategy'] },
          task: { type: 'string' },
        },
        required: ['specialist', 'task'],
        additionalProperties: false,
      }),
      execute: async ({ specialist, task }) => {
        if (!provider || !modelId) return { error: 'No hay modelo configurado para la sub-IA.' };
        setAgentState('tool_call');
        const specialistTools = businessSpecialistTools(projectPath, recordToolEvent, setAgentState);
        const result = await runStream({
          model: provider(modelId),
          system: `Sos la sub-IA de ${specialist} del asesor de negocios de Codeclub. Investigá solo la tarea recibida. Podés leer código, datos comerciales y WhatsApp; nunca edites archivos ni envíes mensajes. Devolvé hallazgos, supuestos y recomendación en español.`,
          messages: [{ role: 'user', content: specialist === 'developer' ? `Implementá la tarea en el workspace. Usá las tools de escritura o ejecución disponibles, verificá el resultado y no afirmes cambios sin evidencia.\n\n${task}` : task }],
          tools: specialistTools,
          callbacks: {
            onTextDelta: () => {},
            onUsage: (usage) => persistSubagentUsage(projectPath, modelId, `business-${specialist}`, usage),
          },
        });
        recordToolEvent('delegateBusinessSpecialist', { specialist, task }, result);
        return result;
      },
    }),
  };
}

export function selectToolsForPrompt(toolset: Record<string, any>, mode: 'business' | 'development', prompt: string) {
  const text = prompt.toLowerCase();
  const keys = new Set(mode === 'business'
    ? ['listProjectFiles', 'readProjectFile', 'searchProjectText', 'getBusinessWorkspace', 'getAIUsageMetrics']
    : ['listFiles', 'readFile', 'searchText', 'askUser', 'createPlan', 'updatePlan', 'todo', 'getTaskStatus']);

  const add = (...names: string[]) => names.forEach((name) => keys.add(name));
  const has = (...terms: string[]) => terms.some((term) => text.includes(term));

  if (mode === 'business') {
    if (has('cotiz', 'presupuesto', 'propuesta', 'precio', 'tarifa', 'estim')) add('createQuote', 'createBudget', 'updateBusinessWorkspace');
    if (has('plan', 'hito', 'roadmap', 'estrateg')) add('createExecutionPlan', 'updateBusinessWorkspace');
    if (has('whatsapp', 'cliente', 'conversación', 'conversacion', 'crm')) add('getWhatsAppBusinessContext');
    if (has('proyecto', 'portfolio', 'cartera')) add('listIndexedProjects');
    if (has('log', 'auditar', 'ejecución', 'ejecucion', 'herramientas')) add('getExecutionLog');
    if (has('sub-ia', 'subia', 'especialista', 'deleg', 'investig')) add('delegateBusinessSpecialist');
  } else {
    // Failsafe de escritura: el router IA sigue siendo la decisión principal.
    if (has('editar', 'modific', 'crear', 'crea', 'creá', 'armar', 'armá', 'hacer', 'hacé', 'agregar', 'agrega', 'agregá', 'meter', 'mete', 'meté', 'carpeta', 'archivo', 'txt', 'escrib', 'implement', 'fix', 'correg', 'refactor', 'cambio')) add('writeFile');
    if (has('terminal', 'comando', 'ejecut', 'build', 'compil', 'test', 'prueba', 'git', 'servidor', 'background', 'proceso')) add('runCommand', 'terminal');
    if (has('sub-ia', 'subia', 'subagente', 'especialista', 'deleg')) add('subagent');
    if (has('memoria', 'recordá', 'recorda', 'acordate', 'olvid', 'recuper')) add('remember', 'recall', 'forget');
    if (has('log', 'auditar', 'ejecución', 'ejecucion', 'herramientas', 'debug')) add('getExecutionLog');
  }

  return Object.fromEntries([...keys].filter((name) => toolset[name]).map((name) => [name, toolset[name]]));
}

const TOOL_ROUTER_CATALOG: Record<'business' | 'development', Record<string, string>> = {
  development: {
    listFiles: 'listar archivos del workspace', readFile: 'leer archivos', searchText: 'buscar texto en archivos', writeFile: 'crear o editar archivos; también crea carpetas padre', runCommand: 'ejecutar comandos, tests, Git o procesos', terminal: 'crear procesos persistentes en background', askUser: 'pedir una decisión al usuario', createPlan: 'crear planes de implementación', updatePlan: 'actualizar planes', todo: 'crear o actualizar tareas TODO', getTaskStatus: 'consultar estado de tareas', subagent: 'delegar investigación a un subagente', remember: 'guardar memoria', recall: 'consultar memoria', forget: 'borrar memoria', getExecutionLog: 'auditar ejecuciones y tools',
  },
  business: {
    listProjectFiles: 'listar archivos del proyecto', readProjectFile: 'leer archivos del proyecto', searchProjectText: 'buscar texto en el proyecto', getBusinessWorkspace: 'leer datos económicos', getAIUsageMetrics: 'medir tokens, duración y costos', updateBusinessWorkspace: 'actualizar datos económicos', createQuote: 'crear cotizaciones', createBudget: 'crear presupuestos', createExecutionPlan: 'crear planes de ejecución', getWhatsAppBusinessContext: 'consultar contexto comercial de WhatsApp', listIndexedProjects: 'listar proyectos', getExecutionLog: 'auditar ejecuciones y tools', delegateBusinessSpecialist: 'delegar investigación comercial',
  },
};

const toolRouterOutput = Output.object({
  schema: jsonSchema({
    type: 'object',
    properties: {
      tools: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
      reason: { type: 'string' },
      requiresAction: { type: 'boolean' },
      goal: { type: 'string' },
      verification: { type: 'string' },
    },
    required: ['tools', 'confidence', 'reason', 'requiresAction', 'goal', 'verification'],
    additionalProperties: false,
  }),
});

const toolVerificationOutput = Output.object({
  schema: jsonSchema({
    type: 'object',
    properties: {
      completed: { type: 'boolean' },
      retry: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['completed', 'retry', 'reason'],
    additionalProperties: false,
  }),
});

export async function resolveToolsWithAI({ model, mode, prompt, toolset, signal, onUsage }: { model: any; mode: 'business' | 'development'; prompt: string; toolset: Record<string, any>; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  const catalog = TOOL_ROUTER_CATALOG[mode];
  let decision: { tools?: string[]; confidence?: number; reason?: string; requiresAction?: boolean; goal?: string; verification?: string } | null = null;
  await runStream({
    model,
    system: `Sos el router de herramientas de Codeclub para el modo ${mode === 'business' ? 'Economía' : 'Desarrollo'}. Analizá la intención del usuario y elegí únicamente las tools necesarias del catálogo. No ejecutes tools ni respondas al usuario. Si una acción puede requerir escritura o terminal, habilitala. Siempre incluí las tools base de inspección y organización cuando sean relevantes. Devolvé JSON estructurado. Catálogo: ${Object.entries(catalog).map(([name, description]) => `${name}: ${description}`).join('; ')}`,
    messages: [{ role: 'user', content: prompt }],
    tools: {},
    structuredOutput: toolRouterOutput,
    signal,
    callbacks: {
      onTextDelta: () => {},
      onStructuredOutput: (output) => { decision = output; },
      onUsage,
    },
  });
  const allowed = new Set(Object.keys(toolset));
  const aliases: Record<string, string> = { write_file: 'writeFile', run_command: 'runCommand', ask_user: 'askUser', create_plan: 'createPlan', update_plan: 'updatePlan' };
  const selected = (decision?.tools || []).map((name) => aliases[name] || name).filter((name) => allowed.has(name));
  if (!selected.length) throw new Error('El router IA no habilitó ninguna tool válida.');
  const actionTools = ['writeFile', 'runCommand', 'terminal', 'subagent'].filter((name) => allowed.has(name));
  const resolved = [...new Set(decision?.requiresAction ? [...selected, ...actionTools] : selected)];
  return { tools: Object.fromEntries(resolved.map((name) => [name, toolset[name]])), confidence: decision?.confidence ?? 0, reason: decision?.reason || 'intención detectada', requiresAction: decision?.requiresAction === true, goal: decision?.goal || prompt, verification: decision?.verification || 'La tool correspondiente debe devolver un resultado exitoso.' };
}

export async function verifyToolExecutionWithAI({ model, prompt, goal, verification, toolEvents, changes, signal, onUsage }: { model: any; prompt: string; goal: string; verification: string; toolEvents: any[]; changes: any; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  let result: { completed?: boolean; retry?: boolean; reason?: string } | null = null;
  await runStream({
    model,
    system: 'Sos la IA verificadora de Codeclub. Compará el objetivo y el criterio de verificación con las tools realmente ejecutadas, sus resultados y el diff local. No supongas que el texto del agente es evidencia. Si falta una tool exitosa o el diff no respalda el trabajo, indicá retry=true. Devolvé JSON estructurado.',
    messages: [{ role: 'user', content: JSON.stringify({ prompt, goal, verification, toolEvents: toolEvents.slice(-20), changes }) }],
    tools: {},
    structuredOutput: toolVerificationOutput,
    signal,
    callbacks: { onTextDelta: () => {}, onStructuredOutput: (output) => { result = output; }, onUsage },
  });
  return result || { completed: false, retry: true, reason: 'La IA verificadora no devolvió resultado.' };
}

export function createTools(ctx: ToolContext) {
  const { projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId } = ctx;

  return {
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
      description: 'Create a persistent implementation plan for the active project.',
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
      description: 'Update the active implementation plan or one of its steps.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          planId: { type: 'string', description: 'Optional plan ID. Defaults to the active plan.' },
          title: { type: 'string', description: 'Optional new plan title.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
          stepId: { type: 'string', description: 'Optional step ID to update.' },
          stepStatus: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
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
      description: 'Manage persistent TODO items for the active project.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove', 'clear', 'list'] },
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
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
      description: 'Read the current implementation plan and TODO items for the active project.',
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
      description: 'Write full UTF-8 content to a relative workspace file inside the active workspace.',
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
        const output = { ok: true, path };
        recordToolEvent('writeFile', { path }, output);
        return output;
      },
    }),
    runCommand: tool({
      description: 'Run any command in the active workspace without confirmation.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Any executable command available on the system.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
        },
        required: ['command', 'args'],
        additionalProperties: false,
      }),
      execute: async ({ command, args }) => {
        setAgentState('running');
        const output = await invoke('codeclub_run_command', {
          projectPath,
          request: { command, args: Array.isArray(args) ? args : [] },
        });
        recordToolEvent('runCommand', { command, args }, output);
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
    subagent: tool({
      description: 'Delegate a focused development task to a specialist IA that inspects the codebase with read tools.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          specialist: { type: 'string', enum: ['developer', 'explorer', 'frontend', 'backend', 'qa', 'security', 'documentation'] },
          task: { type: 'string', description: 'The task for the specialist.' },
        },
        required: ['specialist', 'task'],
        additionalProperties: false,
      }),
      execute: async ({ specialist, task }) => {
        if (!provider || !modelId) {
          return { error: 'No provider/model configured for subagent.' };
        }
        setAgentState('tool_call');
        recordToolEvent('subagent', { specialist, task }, { status: 'running' });

        const developmentTools = createTools({ projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId });
        const subTools = specialist === 'developer'
          ? Object.fromEntries(['listFiles', 'readFile', 'searchText', 'writeFile', 'runCommand', 'terminal'].map((name) => [name, developmentTools[name]]).filter(([, toolDefinition]) => toolDefinition))
          : createSubagentTools({ projectPath, recordToolEvent, setAgentState });

        const result = await runStream({
          model: provider(modelId),
          system: 'Sos un agente de investigación de Codeclub. Explorá el código y respondé en español. IMPORTANTE: cuando termines, escribí un resumen claro de tus hallazgos. Ese resumen será devuelto al agente principal.',
          messages: [{ role: 'user', content: task }],
          tools: subTools,
          callbacks: {
            onTextDelta: () => {},
            onUsage: (usage) => persistSubagentUsage(projectPath, modelId, `development-${specialist}`, usage),
          },
        });

        recordToolEvent('subagent', { specialist, task }, { result });
        return result;
      },
    }),
    remember: tool({
      description: 'Save information to memory. Tags link memories to items (chat:abc, note:xyz, table:xyz). Duplicate keys update existing.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Unique memory key.' },
          content: { type: 'string', description: 'Content to remember.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags like ["chat:id", "preference"].' },
        },
        required: ['key', 'content'],
        additionalProperties: false,
      }),
      execute: async ({ key, content, tags }) => {
        setAgentState('tool_call');
        await saveMemory(projectPath, key, content, tags || []);
        recordToolEvent('remember', { key, tags }, { ok: true });
        return { ok: true };
      },
    }),
    recall: tool({
      description: 'Retrieve memories by exact key or search by tag keyword. Returns matching entries.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Key or tag text to search.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async ({ query }) => {
        setAgentState('tool_call');
        const results = await searchMemory(projectPath, query);
        recordToolEvent('recall', { query }, { count: results.length });
        return results;
      },
    }),
    forget: tool({
      description: 'Delete a specific memory by its exact key.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Exact memory key to delete.' },
        },
        required: ['key'],
        additionalProperties: false,
      }),
      execute: async ({ key }) => {
        setAgentState('tool_call');
        const ok = await deleteMemory(projectPath, key);
        recordToolEvent('forget', { key }, { ok });
        return { ok };
      },
    }),
  };
}
