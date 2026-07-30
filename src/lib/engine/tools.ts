import { invoke } from '@tauri-apps/api/core';
import { jsonSchema, Output, tool } from 'ai';
import type { ToolContext } from './types';
import { runStream } from './run';
import { saveMemory, searchMemory, deleteMemory } from './memory';
import { createId, readAgentState, writeAgentState, type TaskStatus } from './planning';
import { ensureBusinessWorkspace, readBusinessWorkspace, writeBusinessWorkspace } from '../projectManager';
import { appendGenerationUsage, readGenerationUsage, summarizeGenerationUsage } from '../usage';
import { readExecutionLog } from '../execution-log';

const specialistHandoff = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

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

const SWARM_DISPLAY_NAMES = ['Atlas', 'Hermes', 'Atenea', 'Apolo', 'Artemisa', 'Nix', 'Gaia', 'Eros'];
const CHILD_DISPLAY_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const MAX_ACTIVE_CHILDREN = 4;
type SwarmChild = { id: string; name: string; specialist: string; task: string; status: string; messages: string[]; result?: string };
type SwarmState = { id: string; name: string; status: string; children: Record<string, SwarmChild> };
const swarmStore = new Map<string, SwarmState>();
const swarmChildTools = new Map<string, Record<string, any>>();
const PARENT_ONLY_TOOLS = new Set(['createPlan', 'updatePlan', 'todo', 'getTaskStatus', 'createQuote', 'createBudget', 'createExecutionPlan', 'updateBusinessWorkspace']);
const ECONOMY_READ_TOOLS = ['listProjectFiles', 'readProjectFile', 'searchProjectText', 'listIndexedProjects', 'getBusinessWorkspace', 'getAIUsageMetrics', 'getExecutionLog'];

function createSwarmTool(ctx: { projectPath: string; projectScoped?: boolean; recordToolEvent: (name: string, input: any, output: any) => void; setAgentState: (state: string) => void; requestToolApproval?: (opts: { toolName: string; input: any; summary: string }) => Promise<boolean>; childTools?: Record<string, any>; provider?: any; modelId?: string }) {
  const { projectPath, projectScoped = false, recordToolEvent, setAgentState, requestToolApproval, childTools = {}, provider, modelId } = ctx;
  const runChild = async (swarm: SwarmState, child: SwarmChild, message: string) => {
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
  return {
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
          template: { type: 'string', enum: ['read_only', 'developer', 'economist', 'custom'] },
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
            return { swarmName: swarm.name, status: 'blocked', error: `LÃ­mite de ${MAX_ACTIVE_CHILDREN} hijos activos alcanzado. EsperÃ¡, mergeÃ¡ o detenÃ© uno antes de crear otro.` };
          }
          const name = childName || CHILD_DISPLAY_NAMES[Object.keys(swarm.children).length % CHILD_DISPLAY_NAMES.length];
          const child: SwarmChild = { id: childId || createId('child'), name, specialist: specialist || template || 'explorer', task: task || '', status: 'pending', messages: [] };
          const selectedTools = template === 'read_only'
            ? Object.fromEntries(Object.entries(childTools).filter(([name]) => ['listFiles', 'readFile', 'searchText', ...ECONOMY_READ_TOOLS].includes(name)))
            : template === 'economist'
              ? Object.fromEntries(Object.entries(childTools).filter(([name]) => ECONOMY_READ_TOOLS.includes(name)))
            : requestedTools?.length
              ? Object.fromEntries(requestedTools.filter((name) => childTools[name] && !PARENT_ONLY_TOOLS.has(name) && !['swarm', 'subagent', 'delegateBusinessSpecialist'].includes(name)).map((name) => [name, childTools[name]]))
              : Object.fromEntries(Object.entries(childTools).filter(([name]) => !PARENT_ONLY_TOOLS.has(name) && !['swarm', 'subagent', 'delegateBusinessSpecialist', 'listAvailableTools'].includes(name)));
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
  const resolveProjectPath = (requestedPath?: string) => {
    const requested = String(requestedPath || '').trim();
    if (!requested && indexedProjects.some((project) => project.path === projectPath)) return projectPath;
    const match = indexedProjects.find((project) => project.path === requested || project.name.toLowerCase() === requested.toLowerCase());
    if (match) return match.path;
    throw new Error('Indicá un proyecto indexado válido por nombre o ruta antes de consultar o guardar datos económicos.');
  };
  const projectPathProperty = { projectPath: { type: 'string', description: 'Nombre o ruta de un proyecto indexado. Omitir solo si ya hay un proyecto activo.' } };
  return {
    ...createSwarmTool({ projectPath, recordToolEvent, setAgentState, provider, modelId }),
    listProjectFiles: tool({
      description: 'List project files for business context. Read-only; skips heavy folders.',
      inputSchema: jsonSchema({ type: 'object', properties: { maxFiles: { type: 'number' }, ...projectPathProperty }, additionalProperties: false }),
      execute: async ({ maxFiles, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const output = await invoke('codeclub_list_files', { projectPath: targetProjectPath, maxFiles: Math.min(Number(maxFiles) || 400, 1200) });
        recordToolEvent('listProjectFiles', { maxFiles, projectPath: targetProjectPath }, output);
        return output;
      },
    }),
    readProjectFile: tool({
      description: 'Read a UTF-8 project file for business analysis. Read-only; never modifies it.',
      inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string' }, ...projectPathProperty }, required: ['path'], additionalProperties: false }),
      execute: async ({ path, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const output = await invoke('codeclub_read_file', { projectPath: targetProjectPath, path });
        recordToolEvent('readProjectFile', { path, projectPath: targetProjectPath }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchProjectText: tool({
      description: 'Search project code and documentation for business context. Read-only.',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' }, maxMatches: { type: 'number' }, ...projectPathProperty }, required: ['query'], additionalProperties: false }),
      execute: async ({ query, maxMatches, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const output = await invoke('codeclub_search_text', { projectPath: targetProjectPath, query, maxMatches: Math.min(Number(maxMatches) || 80, 200) });
        recordToolEvent('searchProjectText', { query, maxMatches, projectPath: targetProjectPath }, output);
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
      description: 'Read the business and economy workspace of the active project or a named indexed project.',
      inputSchema: jsonSchema({ type: 'object', properties: projectPathProperty, additionalProperties: false }),
      execute: async ({ projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const workspace = await readBusinessWorkspace(targetProjectPath);
        const quotes = workspace?.quotes || [];
        const summary = workspace ? {
          estimatedValue: Number(workspace.project.estimated_value || 0),
          contractedValue: Number(workspace.project.contracted_value || 0),
          quotedValue: quotes.reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0),
          acceptedValue: quotes.filter((quote: any) => quote.status === 'accepted').reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0),
          pipelineValue: quotes.filter((quote: any) => ['draft', 'sent'].includes(String(quote.status || 'draft'))).reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0),
        } : null;
        const output = workspace ? { ...workspace, summary } : workspace;
        recordToolEvent('getBusinessWorkspace', { projectPath: targetProjectPath }, output || { status: 'empty' });
        return output || { status: 'empty', message: 'El proyecto todavía no tiene datos comerciales.' };
      },
    }),
    getAIUsageMetrics: tool({
      description: 'Read local AI generation usage for this project and summarize tokens, duration and estimated provider cost for an optional date range.',
      inputSchema: jsonSchema({ type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD.' }, to: { type: 'string', description: 'End date YYYY-MM-DD.' }, ...projectPathProperty }, additionalProperties: false }),
      execute: async ({ from, to, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const output = summarizeGenerationUsage(await readGenerationUsage(targetProjectPath), from, to);
        recordToolEvent('getAIUsageMetrics', { from, to, projectPath: targetProjectPath }, output);
        return output;
      },
    }),
    getExecutionLog: tool({
      description: 'Read the structured execution log for the active project: tools used, inputs, outputs and timestamps. Use it to inspect delegated work without relying on private chain-of-thought.',
      inputSchema: jsonSchema({ type: 'object', properties: { limit: { type: 'number' }, ...projectPathProperty }, additionalProperties: false }),
      execute: async ({ limit, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const output = await readExecutionLog(targetProjectPath, limit);
        recordToolEvent('getExecutionLog', { limit, projectPath: targetProjectPath }, output);
        return output;
      },
    }),
    updateBusinessWorkspace: tool({
      description: 'Update one business workspace section. Use for project status, estimated or contracted value, value pricing, dashboard visibility, outcomes, quotes, milestones, payments, clients, opportunities, estimates, expenses, invoices or notes.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['project', 'profile', 'pricing', 'dashboard', 'opportunities', 'estimates', 'quotes', 'outcomes', 'milestones', 'payments', 'expenses', 'invoices', 'notes'] },
          data: { description: 'Complete replacement value for the selected section.' },
          ...projectPathProperty,
        },
        required: ['section', 'data'],
        additionalProperties: false,
      }),
      execute: async ({ section, data, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const current = await ensureBusinessWorkspace(targetProjectPath);
        const next = await writeBusinessWorkspace(targetProjectPath, { ...current, [section]: data });
        recordToolEvent('updateBusinessWorkspace', { section, data, projectPath: targetProjectPath }, next);
        return next;
      },
    }),
    createQuote: tool({
      description: 'Create and persist a value-based project quotation. Each line item must represent a result or deliverable, never hours; do not only describe it in text.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          currency: { type: 'string' },
          ...projectPathProperty,
          items: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['outcome', 'deliverable', 'milestone'] }, description: { type: 'string' }, outcome: { type: 'string' }, metric: { type: 'string' }, amount: { type: 'number' } }, required: ['type', 'description', 'outcome', 'metric', 'amount'], additionalProperties: false } },
          status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected'] },
        },
        required: ['title', 'description', 'items'],
        additionalProperties: false,
      }),
      execute: async ({ title, description, currency, items, status, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const current = await ensureBusinessWorkspace(targetProjectPath);
        const normalizedItems = (items || []).map((item) => ({ type: item.type || 'deliverable', description: item.description, outcome: item.outcome, metric: item.metric, amount: Number(item.amount || 0), total: Number(item.amount || 0) }));
        const quote = { id: createId('quote'), title, description, currency: currency || current.currency || 'USD', items: normalizedItems, total: normalizedItems.reduce((sum, item) => sum + item.total, 0), status: status || 'draft', createdAt: new Date().toISOString() };
        const next = await writeBusinessWorkspace(targetProjectPath, { ...current, quotes: [...(current.quotes || []), quote] });
        recordToolEvent('createQuote', { title, description, currency, items, status, projectPath: targetProjectPath }, quote);
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
      description: 'Create and persist a structured execution plan for a business initiative.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          ...projectPathProperty,
        },
        required: ['title', 'objective', 'steps'],
        additionalProperties: false,
      }),
      execute: async ({ title, objective, steps, projectPath: requestedProject }) => {
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const plan = { id: createId('business-plan'), type: 'execution_plan', title, objective, steps, status: 'draft', createdAt: new Date().toISOString() };
        const current = await ensureBusinessWorkspace(targetProjectPath);
        const workspace = await writeBusinessWorkspace(targetProjectPath, { ...current, milestones: [...(current.milestones || []), plan] });
        const output = { ok: true, plan, workspace };
        recordToolEvent('createExecutionPlan', { title, objective, steps, projectPath: targetProjectPath }, output);
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
          specialist: { type: 'string', enum: ['commercial', 'pricing', 'finance', 'operations', 'strategy'] },
          task: { type: 'string', maxLength: 500, description: 'English handoff, maximum 500 characters.' },
          ...projectPathProperty,
        },
        required: ['specialist', 'task'],
        additionalProperties: false,
      }),
      execute: async ({ specialist, task: rawTask, projectPath: requestedProject }) => {
        if (!provider || !modelId) return { error: 'No hay modelo configurado para la sub-IA.' };
        setAgentState('tool_call');
        const targetProjectPath = resolveProjectPath(requestedProject);
        const specialistTools = businessSpecialistTools(targetProjectPath, recordToolEvent, setAgentState);
        const task = specialistHandoff(rawTask);
        const result = await runStream({
          model: provider(modelId),
          system: `Sos la sub-IA de ${specialist} del asesor de negocios de Codeclub. Investigá solo la tarea recibida. Podés leer código, datos comerciales y WhatsApp; nunca edites archivos ni envíes mensajes. Devolvé hallazgos, supuestos y recomendación en español.`,
          messages: [{ role: 'user', content: specialist === 'developer' ? `Implementá la tarea en el workspace. Usá las tools de escritura o ejecución disponibles, verificá el resultado y no afirmes cambios sin evidencia.\n\n${task}` : task }],
          tools: specialistTools,
          callbacks: {
            onTextDelta: () => {},
            onUsage: (usage) => persistSubagentUsage(targetProjectPath, modelId, `business-${specialist}`, usage),
          },
        });
        const resultHandoff = specialistHandoff(result);
        recordToolEvent('delegateBusinessSpecialist', { specialist, task, projectPath: targetProjectPath }, resultHandoff);
        return resultHandoff;
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
    if (has('panel', 'dashboard', 'mostrar', 'ocultar', 'esconder', 'visibilidad')) add('getBusinessWorkspace', 'updateBusinessWorkspace');
    if (has('proyecto', 'portfolio', 'cartera')) add('listIndexedProjects');
    if (has('log', 'auditar', 'ejecución', 'ejecucion', 'herramientas')) add('getExecutionLog');
    if (has('sub-ia', 'subia', 'especialista', 'deleg', 'investig')) add('delegateBusinessSpecialist');
  } else {
    // Failsafe de escritura: el router IA sigue siendo la decisión principal.
    if (has('editar', 'modific', 'crear', 'crea', 'creá', 'armar', 'armá', 'hacer', 'hacé', 'agregar', 'agrega', 'agregá', 'meter', 'mete', 'meté', 'carpeta', 'archivo', 'txt', 'escrib', 'implement', 'fix', 'correg', 'refactor', 'cambio')) add('writeFile');
    if (has('terminal', 'comando', 'ejecut', 'build', 'compil', 'test', 'prueba', 'git', 'servidor', 'background', 'proceso', 'bloc', 'notepad', 'pc', 'computadora')) add('runCommand', 'terminal');
    if (has('sub-ia', 'subia', 'subagente', 'especialista', 'deleg')) add('subagent');
    if (has('navegador', 'browser', 'web', 'url', 'dom', 'elemento', 'botón', 'boton', 'click', 'clic', 'escrib')) add('openBrowser', 'getBrowserState', 'browserAction');
    if (has('memoria', 'recordá', 'recorda', 'acordate', 'olvid', 'recuper')) add('remember', 'recall', 'forget');
    if (has('log', 'auditar', 'ejecución', 'ejecucion', 'herramientas', 'debug')) add('getExecutionLog');
  }

  if (mode === 'development' && has('control de pc', 'computadora', 'mouse', 'teclado', 'navegador', 'edge', 'notepad', 'bloc de notas')) add('subagent', 'runCommand', 'openBrowser', 'getBrowserState', 'browserAction');

  return Object.fromEntries([...keys].filter((name) => toolset[name]).map((name) => [name, toolset[name]]));
}

const TOOL_ROUTER_CATALOG: Record<'business' | 'development', Record<string, string>> = {
  development: {
    listFiles: 'listar archivos del workspace', readFile: 'leer archivos', searchText: 'buscar texto en archivos', writeFile: 'crear o editar archivos; también crea carpetas padre', runCommand: 'ejecutar comandos, tests, Git o procesos', terminal: 'crear procesos persistentes en background', openBrowser: 'abrir una URL en la pestaña Navegador', getBrowserState: 'obtener estado DOM y accesibilidad del navegador como JSON', browserAction: 'hacer click, escribir, pulsar teclas o scroll usando selectores', askUser: 'pedir una decisión al usuario', createPlan: 'crear planes de implementación', updatePlan: 'actualizar planes', todo: 'crear o actualizar tareas TODO', getTaskStatus: 'consultar estado de tareas', subagent: 'delegar investigación a un subagente', remember: 'guardar memoria', recall: 'consultar memoria', forget: 'borrar memoria', getExecutionLog: 'auditar ejecuciones y tools',
  },
  business: {
    listProjectFiles: 'listar archivos del proyecto', readProjectFile: 'leer archivos del proyecto', searchProjectText: 'buscar texto en el proyecto', getBusinessWorkspace: 'leer datos económicos y configuración del panel', getAIUsageMetrics: 'medir tokens, duración y costos', updateBusinessWorkspace: 'actualizar datos económicos o visibilidad de paneles', createQuote: 'crear cotizaciones', createBudget: 'crear presupuestos', createExecutionPlan: 'crear planes de ejecución', listIndexedProjects: 'listar proyectos', getExecutionLog: 'auditar ejecuciones y tools', delegateBusinessSpecialist: 'delegar investigación comercial',
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

export type AgentMode = 'development' | 'business';
export type AgentSpecialist = 'primary' | 'developer' | 'explorer' | 'frontend' | 'backend' | 'qa' | 'security' | 'documentation' | 'computer_use' | 'commercial' | 'pricing' | 'finance' | 'operations' | 'strategy';

const agentRouteOutput = Output.object({
  schema: jsonSchema({
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['development', 'business'] },
      specialist: { type: 'string', enum: ['primary', 'developer', 'explorer', 'frontend', 'backend', 'qa', 'security', 'documentation', 'computer_use', 'commercial', 'pricing', 'finance', 'operations', 'strategy'] },
      confidence: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['mode', 'specialist', 'confidence', 'reason'],
    additionalProperties: false,
  }),
});

export async function resolveAgentRouteWithAI({ model, prompt, modeOverride, signal, onUsage }: { model: any; prompt: string; modeOverride?: 'auto' | AgentMode; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  let route: { mode?: AgentMode; specialist?: AgentSpecialist; confidence?: number; reason?: string } | null = null;
  await runStream({
    model,
    system: 'You are Codeclub\'s agent orchestrator. Select the best mode and specialist for the request. Return only structured JSON. Use primary when the main agent can solve it. Use business for economics, pricing, sales, clients, quotes, ROI or the business panel; use development for code, files, tests, browser or PC control.',
    messages: [{ role: 'user', content: JSON.stringify({ prompt, modeOverride: modeOverride && modeOverride !== 'auto' ? modeOverride : null }) }],
    tools: {},
    structuredOutput: agentRouteOutput,
    signal,
    callbacks: {
      onTextDelta: () => {},
      onStructuredOutput: (output) => { route = output; },
      onUsage,
    },
  });
  if (!route?.mode || !route.specialist) throw new Error('La orquestadora no devolvio un modo y especialista validos.');
  const mode = modeOverride && modeOverride !== 'auto' ? modeOverride : route.mode;
  const businessSpecialists = new Set<AgentSpecialist>(['commercial', 'pricing', 'finance', 'operations', 'strategy']);
  const developmentSpecialists = new Set<AgentSpecialist>(['developer', 'explorer', 'frontend', 'backend', 'qa', 'security', 'documentation', 'computer_use']);
  const specialist = mode === 'business' && developmentSpecialists.has(route.specialist) || mode === 'development' && businessSpecialists.has(route.specialist) ? 'primary' : route.specialist;
  return { mode, specialist, confidence: route.confidence ?? 0, reason: route.reason || 'Ruta seleccionada por la orquestadora.' };
}

export function inferAgentMode(prompt: string): AgentMode {
  const text = prompt.toLowerCase();
  return /econom|precio|cotiz|presupuesto|propuesta|valor|fee|margen|roi|cliente|venta|negocio|comercial|factur|ingreso|gasto|rentab|panel/.test(text) ? 'business' : 'development';
}

export function inferAgentSpecialist(prompt: string, mode: AgentMode): AgentSpecialist {
  const text = prompt.toLowerCase();
  if (mode === 'business') {
    if (/cotiz|precio|pricing|valor|fee|margen|roi/.test(text)) return 'pricing';
    if (/cliente|venta|comercial/.test(text)) return 'commercial';
    if (/finanz|gasto|ingreso|costo|rentab|presupuesto/.test(text)) return 'finance';
    if (/operaci|proceso|hito|entrega/.test(text)) return 'operations';
    return 'strategy';
  }
  if (/navegador|browser|pc|mouse|teclado|edge|youtube/.test(text)) return 'computer_use';
  if (/test|qa|probar|error|bug|falla/.test(text)) return 'qa';
  if (/ui|ux|diseño|css|componente|interfaz/.test(text)) return 'frontend';
  if (/api|backend|servidor|rust|tauri|base de datos/.test(text)) return 'backend';
  if (/document|readme|explicar/.test(text)) return 'documentation';
  return 'developer';
}

export async function resolveToolsWithAI({ model, mode, prompt, toolset, signal, onUsage }: { model: any; mode: 'business' | 'development'; prompt: string; toolset: Record<string, any>; signal?: AbortSignal; onUsage?: (usage: any) => void | Promise<void> }) {
  return { tools: toolset, confidence: 1, reason: 'El agente principal recibe todas las tools.', requiresAction: false, goal: prompt, verification: '' };
  const catalog = TOOL_ROUTER_CATALOG[mode];
  let decision: { tools?: string[]; confidence?: number; reason?: string; requiresAction?: boolean; goal?: string; verification?: string } | null = null;
  await runStream({
    model,
    system: `Sos el router de herramientas de Codeclub para el modo ${mode === 'business' ? 'Economía' : 'Desarrollo'}. Analizá la intención del usuario y elegí únicamente las tools necesarias del catálogo. No ejecutes tools ni respondas al usuario. Si una acción puede requerir escritura o terminal, habilitala. Siempre incluí las tools base de inspección y organización cuando sean relevantes. Devolvé JSON estructurado. Catálogo: ${Object.entries(catalog).map(([name, description]) => `${name}: ${description}`).join('; ')}`,
    messages: [{ role: 'user', content: `ROUTER CONTRACT: no respondas al usuario; devolve solo JSON. Elegi la menor cantidad de tools suficiente. En Economia prioriza datos comerciales y workspace antes que codigo. No delegues si el agente principal puede resolverlo. Si hay escritura, guardado, cotizacion, plan o ejecucion, marca requiresAction=true y define evidencia observable.\n\nINTENCION: ${prompt}` }],
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
    system: 'Sos la IA verificadora de Codeclub. Compará el objetivo y el criterio de verificación con las tools realmente ejecutadas, sus resultados y el diff local. No supongas que el texto del agente es evidencia. Para control de PC exigí evidencia observable: proceso, ventana, URL, salida estructurada o estado posterior; un código 0 por sí solo no prueba que una interfaz haya cambiado ni que un video esté disponible. Si falta evidencia, el resultado contradice el objetivo o aparece contenido no disponible, indicá retry=true y pedí observar nuevamente antes de repetir acciones. Devolvé JSON estructurado.',
    messages: [{ role: 'user', content: JSON.stringify({ contract: 'VERIFICATION CONTRACT: valida solamente outputs reales. Si falta evidencia, contradice el objetivo o una UI no fue observada despues de actuar, completed=false y retry=true. Nunca conviertas texto del agente, codigo 0 aislado o una intencion en evidencia.', prompt, goal, verification, toolEvents: toolEvents.slice(-20), changes }) }],
    tools: {},
    structuredOutput: undefined,
    signal,
    callbacks: { onTextDelta: () => {}, onStructuredOutput: (output) => { result = output; }, onUsage },
  });
  return result || { completed: false, retry: true, reason: 'La IA verificadora no devolvió resultado.' };
}

export function createTools(ctx: ToolContext) {
  const { projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId } = ctx;

  return {
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
    openBrowser: tool({
      description: 'Open a web URL in Codeclub’s Browser tab so the user can inspect it and reference the page or selected text in chat.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http or https URL to open.' } },
        required: ['url'],
        additionalProperties: false,
      }),
      execute: async ({ url }) => {
        const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
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
      description: 'Interact with the active browser using a selector from getBrowserState. Supports click, type, key and scroll; does not require model vision.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['click', 'type', 'key', 'scroll'] },
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
          const handleResult = (event: Event) => { cleanup(); resolve((event as CustomEvent).detail || { ok: false, error: 'Resultado vacío.' }); };
          window.addEventListener('codeclub:browser-action-result', handleResult, { once: true });
          timer = window.setTimeout(() => { cleanup(); resolve({ ok: false, error: 'No se recibió confirmación de la acción.' }); }, 5000);
          window.dispatchEvent(new CustomEvent('codeclub:browser-action', { detail: action }));
        });
        recordToolEvent('browserAction', action, output);
        return output;
      },
    }),
    subagent: tool({
      description: 'Delegate a focused development or computer-control task to a specialist IA.',
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
        const subTools = specialist === 'developer'
          ? Object.fromEntries(['listFiles', 'readFile', 'searchText', 'writeFile', 'runCommand', 'terminal'].map((name) => [name, developmentTools[name]]).filter(([, toolDefinition]) => toolDefinition))
          : specialist === 'computer_use'
            ? Object.fromEntries(['openBrowser', 'getBrowserState', 'browserAction', 'runCommand'].map((name) => [name, developmentTools[name]]).filter(([, toolDefinition]) => toolDefinition))
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

export function createParentTools(ctx: ToolContext & { availableTools: Record<string, any>; artifactTools: Record<string, any>; projectScoped?: boolean }) {
  const { projectPath, projectScoped, recordToolEvent, setAgentState, requestToolApproval, provider, modelId, availableTools, artifactTools } = ctx;
  return {
    ...createSwarmTool({ projectPath, projectScoped, recordToolEvent, setAgentState, requestToolApproval, childTools: availableTools, provider, modelId }),
    ...artifactTools,
    listAvailableTools: tool({
      description: 'List every operational tool that the parent can assign to children. The parent cannot execute these tools directly.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const output = { tools: Object.keys(availableTools), parentTools: Object.keys(artifactTools), templates: ['read_only', 'developer', 'economist', 'custom'] };
        recordToolEvent('listAvailableTools', {}, output);
        return output;
      },
    }),
  };
}
