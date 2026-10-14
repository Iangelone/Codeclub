import { getDesktopBridge, requireDesktopBridge, nativeInvoke as invoke, emitAppEvent } from '../runtime';
/** Application orchestration for a chat run. Presentation and approval controls are supplied through ports. */
import { jsonSchema, tool } from 'ai';
import { MissingModelCredentialError } from './errors';
import { createModelClient, providerRequestHeaders, type ModelProvider, type SelectedModel } from './model-client';
import { generateTurnSummary } from '../turn-summary';
import { buildChatContext } from '../chat-context';
import { createDynamicToolAccess, createTools, inferAgentSpecialist, selectToolsForPrompt, resolveToolsWithAI, type AgentMode, type AgentSpecialist } from '../engine/tools';
import { runStream } from '../engine/run';

import { getSetting } from '../persistence';
import { appendGenerationUsage, type GenerationUsageRecord } from '../usage';
import { appendExecutionLog } from '../execution-log';
import { readGlobalChats, readGlobalChatHistory, readProjectMeta } from '../projectManager';
import { connectAllAgentPluginMcp, loadAgentPlugins } from '../agent-plugins';
import { credentialKeyFor, credentialTargetFor, modelIdFor, usesGateway } from '../ai-routing';
import { readWorkspaceSnapshot, summarizeWorkspaceDelta, type WorkspaceSnapshot } from '../workspace-changes';
import { readProjectChatHistory } from '../chat-files';
import { getArtifactOutputConfig, formatArtifactOutput, formatToolExecutionFallback } from '../chat-artifacts';
import { translate, type AppLanguage } from '../i18n';

export interface ChatExecutionPorts {
  isCurrent: () => boolean;
  onMessages: (messages: any[]) => void;
  onState: (state: string) => void;
  onTool: (name: string) => void;
  onDisplayTool: (name: string) => void;
  onComputerUse: () => void;
  onAbort: () => void;
  onCredentialRequired: (provider: ModelProvider) => void;
  requestApproval: (request: { toolName: string; input: any; summary: string }) => Promise<boolean>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}
export interface ChatExecutionRequest {
  chat: { chatId: string; projectPath: string };
  projectPath: string;
  currentProvider: ModelProvider | null;
  currentModel: SelectedModel | null;
  language: AppLanguage;
  content: string;
  visibleContent: string;
  newMessages: any[];
  userMessage: { historyIndex: number };
  attachmentParts: any[];
  activeSkills: Array<{ name: string; content: string }>;
  activeExtensions: Array<{ name: string; instruction: string }>;
  agentOrb?: { allowComputer?: boolean; requiresAdministrator?: boolean; maximumAutonomy?: boolean };
  abortController: AbortController;
  desktopModelFetch: typeof fetch;
  ports: ChatExecutionPorts;
}
export async function executeChatRun({ chat, projectPath, currentProvider, currentModel, language, content, visibleContent, newMessages, userMessage, attachmentParts, activeSkills, activeExtensions, agentOrb, abortController, desktopModelFetch, ports }: ChatExecutionRequest) {
  const chatId = chat.chatId;
  let pluginMcpClose: (() => Promise<unknown>) | undefined;
  let assistantUpdateFrame: number | null = null;
  let toolStateTimer: ReturnType<typeof setTimeout> | null = null;
  try {
      if (!currentProvider || !currentModel) {
        throw new Error(translate('chatInterface.chooseAProviderAndModelBeforeSending', language));
      }

      const useGateway = usesGateway(currentProvider, currentModel);
      const credentialKey = credentialKeyFor(currentProvider, currentModel);
      let apiKey = await getSetting(credentialKey, '');

      const requiresCredential = useGateway || currentProvider.requiresApiKey !== false;
      if ((!apiKey || apiKey === 'dummy-key') && currentProvider.id !== 'custom' && requiresCredential) {
        ports.onCredentialRequired(credentialTargetFor(currentProvider, currentModel));
        throw new MissingModelCredentialError(translate('chatInterface.apiKeyMissing', language, { provider: useGateway ? 'AI Gateway' : currentProvider.label || currentProvider.id }));
      }

      const selectedModelReference = modelIdFor(currentProvider, currentModel);
      if (!useGateway && !currentProvider.api) throw new Error(translate('chatInterface.theCatalogDoesNotSpecifyACompatibleEndpointFor', language));
      const configuredHeaders = await getSetting<Record<string, string>>(`codeclub_provider_headers_${currentProvider.id}`, {});
      const requestHeaders = providerRequestHeaders(configuredHeaders, chat.chatId, { 'user-agent': 'Codeclub' });
      const provider = createModelClient({ provider: currentProvider, model: currentModel, apiKey, headers: requestHeaders, fetch: desktopModelFetch });
      const contextProjectPath = projectPath;
      const runMode: AgentMode = 'development';
      let routeSpecialist: AgentSpecialist = 'primary';
      let assistantContent = '';
      const assistantBoundaries: number[] = [];
      const assistantBubbles = (message: any) => {
        const offsets = [...new Set([0, ...assistantBoundaries])].filter(offset => offset < message.content.length);
        return offsets.length < 2 ? [message] : offsets.map((offset, index) => ({ ...message, content: message.content.slice(offset, offsets[index + 1]).trim(), ...(index < offsets.length - 1 ? { tools: [], timeline: [], reasoning: '', progress: '', meta: undefined } : {}) }))
          .filter((bubble, index, bubbles) => index === bubbles.length - 1 || bubble.content.length > 0)
          .map((bubble, index) => ({ ...bubble, historyIndex: userMessage.historyIndex + 1 + index }));
      };
      let assistantReasoning = '';
      let assistantProgress = '';
      let assistantTools: any[] = [];
      let assistantTimeline: any[] = [];
      let executionStartedAt = Date.now();
      let latestUsage: any = null;
      let modelCalls: any[] = [];
      let executionSequence = 0;
      const executionCallQueues = new Map<string, string[]>();
      const updateAssistantMessage = () => {
        ports.onMessages([...newMessages, ...assistantBubbles({ role: 'assistant', content: assistantContent, reasoning: assistantReasoning, progress: assistantProgress, timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo', meta: { modelCalls } })]);
      };
      const scheduleAssistantMessageUpdate = () => {
        if (assistantUpdateFrame !== null) return;
        assistantUpdateFrame = ports.requestFrame(() => {
          assistantUpdateFrame = null;
          updateAssistantMessage();
        });
      };
      const recordToolEvent = (name: string, input: any, output: any) => {
        ports.onTool(name);
        ports.onDisplayTool(name);
        const runningIndex = [...assistantTools].map((event, index) => ({ event, index })).reverse().find(({ event }) => event.name === name && event.output?.status === 'running')?.index;
        const runningEvent = runningIndex === undefined ? null : assistantTools[runningIndex];
        const completedEvent = { ...runningEvent, id: runningIndex === undefined ? (crypto.randomUUID?.() || `${Date.now()}-${assistantTools.length}`) : assistantTools[runningIndex].id, name, input, output, at: new Date().toISOString(), durationMs: runningEvent?.durationMs ?? (runningEvent?.startedAt ? Date.now() - runningEvent.startedAt : null) };
        assistantTools = runningIndex === undefined ? [...assistantTools, completedEvent] : assistantTools.map((event, index) => index === runningIndex ? completedEvent : event);
        updateAssistantMessage();
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: name, input, output });
        if (['writeFile', 'runCommand', 'terminal'].includes(name)) emitAppEvent('codeclub:workspace-changed', { projectPath: contextProjectPath, tool: name });
        if (['todo', 'createPlan', 'updatePlan'].includes(name)) {
          emitAppEvent('codeclub:artifacts-changed', { projectPath: contextProjectPath });
        }
      };
      const orbBrowserOnly = Boolean(agentOrb && agentOrb.allowComputer === false);
      if (agentOrb?.requiresAdministrator && !orbBrowserOnly && !(await invoke<{ elevated: boolean }>('codeclub_admin_status')).elevated) throw new Error('TASK_ADMIN_REQUIRED');
      const toolProjectPath = contextProjectPath || await invoke<string>('codeclub_get_system_root');
      const developmentTools = createTools({
        chatId,
        projectPath: toolProjectPath,
        projectScoped: Boolean(contextProjectPath),
        recordToolEvent,
        setAgentState: ports.onState,
        // Orb tool approval is enforced by the outer wrapper below.
        requestToolApproval: agentOrb ? () => Promise.resolve(true) : ports.requestApproval,
        provider,
        modelId: selectedModelReference,
        providerId: currentProvider.id,
      });
      const externalMcpTools: Record<string, any> = {};
      let loadedPlugins: Awaited<ReturnType<typeof loadAgentPlugins>> = [];
      try {
        loadedPlugins = orbBrowserOnly ? [] : await loadAgentPlugins(contextProjectPath);
        const pluginMcp = await connectAllAgentPluginMcp(loadedPlugins);
        Object.assign(externalMcpTools, pluginMcp.tools);
        pluginMcpClose = pluginMcp.close;
      } catch (error) {
        console.warn('No se pudieron cargar los plugins Agent Plugins:', error);
      }
      let tools: Record<string, any> = {};
      let beforeWorkspaceSnapshot: WorkspaceSnapshot = new Map();
      routeSpecialist = inferAgentSpecialist(content, runMode);
      const selectedToolset = Object.fromEntries(Object.entries(developmentTools).filter(([name]) => !['swarm', 'subagent', 'listAvailableTools'].includes(name)));
      const browserTools = new Set(['openBrowser', 'getBrowserState', 'browserAction', 'askUser']);
      const readOnlyTools = new Set(['listFiles', 'readFile', 'searchText', 'getTaskStatus', 'getExecutionLog', 'getBrowserState', 'androidListDevices', 'androidGetState', 'androidScreenshot', 'askUser']);
      const availableToolset = Object.fromEntries(Object.entries({ ...selectedToolset, ...externalMcpTools }).filter(([name]) => !orbBrowserOnly || browserTools.has(name)).map(([name, definition]: [string, any]) => [name, !agentOrb ? definition : { ...definition, execute: async (input: any, options: any) => {
        if (!agentOrb.maximumAutonomy && !readOnlyTools.has(name) && !await ports.requestApproval({ toolName: name, input, summary: name })) return { cancelled: true };
        return definition.execute(input, options);
      } }]));
      const searchChatContext = async (query: string, page: number, pageSize: number) => {
        const normalized = query.toLowerCase().trim();
        const sources: Array<{ id: string; title: string; project: string; projectPath?: string; chatId: string }> = [];
        const globalChats = await readGlobalChats();
        sources.push(...globalChats.map((item) => ({ id: `global:${item.id}`, title: item.name, project: item.projectName || 'Sin proyecto', chatId: item.id })));
        if (contextProjectPath) {
          const meta = await readProjectMeta(contextProjectPath);
          sources.push(...(meta?.chats || []).map((item) => ({ id: `project:${item.id}`, title: item.customName ? item.name : item.name || 'Chat', project: meta?.name || translate('chatInterface.activeProject', language), projectPath: contextProjectPath, chatId: item.id })));
        }
        const matches = [];
        for (const source of sources) {
          const messages = getDesktopBridge()?.chatSearch ? (await requireDesktopBridge().chatSearch(source.projectPath||'',source.chatId,normalized)).map((content:string)=>({content})) : source.projectPath ? await readProjectChatHistory(source.projectPath, source.chatId) : await readGlobalChatHistory(source.chatId);
          const excerpts = messages.map((message: any) => String(message?.displayContent || message?.content || '')).filter((text: string) => !normalized || text.toLowerCase().includes(normalized));
          if (normalized && !source.title.toLowerCase().includes(normalized) && excerpts.length === 0) continue;
          matches.push({ id: source.id, title: source.title, project: source.project, excerpts: excerpts.slice(-2).map((text: string) => text.slice(0, 500)) });
        }
        const start = (Math.max(page, 1) - 1) * pageSize;
        return { query, page: Math.max(page, 1), pageSize, total: matches.length, hasMore: start + pageSize < matches.length, results: matches.slice(start, start + pageSize) };
      };
      const dynamicToolAccess = createDynamicToolAccess(availableToolset, recordToolEvent, { plugins: loadedPlugins, searchChatContext });
      const artifactNames = ['createPlan', 'updatePlan', 'todo', 'getTaskStatus', 'switchProject'];
      const artifactTools = Object.fromEntries(artifactNames.filter((name) => availableToolset[name]).map((name) => [name, availableToolset[name]]));
      // MCP definitions stay in the searchable catalog and become callable only after discovery.
      tools = { ...dynamicToolAccess, ...artifactTools };
      const routedToolset = tools;
      emitAppEvent('codeclub:agent-route', { mode: runMode, specialist: routeSpecialist, confidence: 1, reason: 'Una única IA ejecuta directamente las tools necesarias.' });
      try {
        const routing = await resolveToolsWithAI({
          model: provider(selectedModelReference),
          mode: runMode,
          prompt: content,
          toolset: routedToolset,
          signal: abortController.signal,
          onUsage: async (usage) => {
            await appendGenerationUsage({
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
              at: new Date().toISOString(),
              projectPath: contextProjectPath,
              chatId: chat?.chatId || '',
              mode: `${runMode}-tool-router`,
              provider: currentProvider.id,
              model: usage.model || currentModel.id,
              inputTokens: usage.inputTokens ?? null,
              outputTokens: usage.outputTokens ?? null,
              totalTokens: usage.totalTokens ?? null,
              reasoningTokens: usage.reasoningTokens ?? null,
              durationMs: usage.durationMs,
              status: 'completed',
            });
          },
        });
        tools = {
          ...routing.tools,
          searchTools: dynamicToolAccess.searchTools,
          executeTool: dynamicToolAccess.executeTool,
        };
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { confidence: routing.confidence, reason: routing.reason, requiresAction: routing.requiresAction, tools: Object.keys(tools) } });
      } catch (error) {
        const fallbackTools = selectToolsForPrompt(routedToolset, runMode, content);
        tools = {
          ...fallbackTools,
          searchTools: dynamicToolAccess.searchTools,
          executeTool: dynamicToolAccess.executeTool,
        };
        void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool-router', input: { mode: runMode, specialist: routeSpecialist, prompt: content }, output: { status: 'fallback-deterministic', error: String(error), tools: Object.keys(tools) } });
      }
      tools = {
        ...tools,
        reportProgress: tool({
          description: 'Show a short, user-facing status of the current task or phase. Call before substantial work and when the phase changes. This is a concise progress label, not private reasoning.',
          inputSchema: jsonSchema<any>({ type: 'object', properties: { summary: { type: 'string', minLength: 2, maxLength: 120, description: 'A brief natural-language phrase describing what you are doing, in the user\'s language.' } }, required: ['summary'], additionalProperties: false }),
          execute: async ({ summary }: { summary: string }) => {
            assistantProgress = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            assistantTimeline = [...assistantTimeline, { type: 'progress', id: crypto.randomUUID(), text: assistantProgress }];
            updateAssistantMessage();
            return { ok: true, summary: assistantProgress };
          },
        }),
      };
      beforeWorkspaceSnapshot = orbBrowserOnly ? new Map() : await readWorkspaceSnapshot(toolProjectPath);
      updateAssistantMessage();
      const system = [
        'You are Codeclub\'s coding agent. Think and operate internally in English. On demand, discover and use tools, skills, plugins, and prior chat context. Before substantial coding tasks, search for a relevant engineering skill and load it when it clearly applies. Verify real results; never invent. Reply in the user\'s language.',
        activeSkills.length ? `The user activated these skills for this session. Follow their relevant workflow while respecting the user's request and project instructions:\n\n${activeSkills.map((skill) => `## ${skill.name}\n\n${skill.content}`).join('\n\n')}` : '',
        'For substantial work, call reportProgress before starting and when moving to a new phase. Use one brief user-facing phrase in the user\'s language (for example, "Inspecting the project" or "Implementing the selected text actions"). These are progress updates, not chain-of-thought; never reveal private reasoning. Do not call it for routine short answers.',
        activeExtensions.length ? `The user selected these built-in extensions for this session: ${activeExtensions.map(extension => `${extension.name}: ${extension.instruction}`).join('\n')}` : '',
        'Codeclub resource management: discover exact targets with listResources. Use createExtension/createSkill/createMcpServer for new packages; editPluginResource for existing manifests or skills; deleteSkill removes only a skill; manageMcpServer updates/removes only the named server; manageOrb handles global orbs. Preserve unrelated resources and scopes. Built-in resources are read-only; create a personal copy when needed. Selected references identify targets but are not requests to mutate them.',
      ].filter(Boolean).join(' ');
      // Some compatible providers reject response_format when tools are enabled.
      // Artifact tools already validate and persist their output, so require JSON
      // only for responses that do not execute tools.
      const structuredOutput = Object.keys(tools).length === 0 ? getArtifactOutputConfig(content) : null;
      let structuredArtifactOutput: any = null;

      const runAssistant = async (retryInstruction = '') => {
        assistantBoundaries.length = 0;
        assistantContent = '';
        assistantReasoning = '';
        assistantTools = [];
        if (!retryInstruction) assistantTimeline = [];
        structuredArtifactOutput = null;
        executionStartedAt = Date.now();
        ports.onState('streaming');
        updateAssistantMessage();
        const storedContext = getDesktopBridge()?.chatContext ? await requireDesktopBridge().chatContext(chat.projectPath,chatId) : null;
        const contextualMessages = buildChatContext(storedContext?.messages || newMessages,storedContext?.summary||'',currentModel.contextWindow);
        const executionMessages: any[] = retryInstruction ? [...contextualMessages, { role: 'user', content: `${retryInstruction}\n\nUse a different strategy or tool sequence; do not repeat the same failed call.` }] : contextualMessages;
        return runStream({
          maxSteps: 128,
          model: provider(selectedModelReference),
          contextWindow:currentModel.contextWindow,
          system,
          messages: executionMessages.map((message, index) => ({
            role: message.role,
            content: index === executionMessages.length - 1 && attachmentParts.length > 0 && !retryInstruction
              ? [{ type: 'text', text: message.content || 'Analizá los archivos adjuntos.' }, ...attachmentParts]
              : message.content,
          })),
          tools,
          structuredOutput,
          signal: abortController.signal,
          callbacks: {
            onAssistantMessageStart: offset => { assistantBoundaries.push(offset); },
            onTextDelta: (content) => {
              if (!ports.isCurrent()) return;
              assistantContent = content;
              scheduleAssistantMessageUpdate();
            },
            onReasoningDelta: (content) => {
              if (!ports.isCurrent()) return;
              assistantReasoning = content;
              const last = assistantTimeline[assistantTimeline.length - 1];
              assistantTimeline = last?.type === 'thinking'
                ? assistantTimeline.map((item, index) => index === assistantTimeline.length - 1 ? { ...item, text: content } : item)
                : [...assistantTimeline, { type: 'thinking', id: crypto.randomUUID?.() || `${Date.now()}-thinking`, text: content }];
              updateAssistantMessage();
            },
            onStructuredOutput: (output) => {
              structuredArtifactOutput = output;
            },
            onAbort: ({ steps }) => {
              if (!ports.isCurrent()) return;
              ports.onAbort();
              ports.onTool('');
              ports.onState('idle');

              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'generation.abort', input: { steps: steps.length }, output: { status: 'aborted' } });
            },
            onEnd: () => {
              if (!ports.isCurrent()) return;
              ports.onTool('');
              ports.onDisplayTool('');
            },
            onModelCall: (metrics) => {
              if (!ports.isCurrent()) return;
              modelCalls = [...modelCalls.filter(call => call.callId !== metrics.callId), metrics];
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: `generation.model.${metrics.status}`, input: { callId: metrics.callId, stepNumber: metrics.stepNumber, attempt: metrics.attempt }, output: metrics });
              updateAssistantMessage();
            },
            onStepEnd: ({ stepNumber, finishReason, toolCalls, usage, performance }) => {
              if (!ports.isCurrent()) return;
              void appendExecutionLog({
                projectPath: contextProjectPath,
                chatId: chat?.chatId,
                tool: 'generation.step',
                input: { stepNumber, tools: (toolCalls || []).map((toolCall: any) => toolCall.toolName) },
                output: { finishReason, usage, performance: { stepTimeMs: performance?.stepTimeMs, responseTimeMs: performance?.responseTimeMs, timeToFirstOutputMs: performance?.timeToFirstOutputMs, toolExecutionMs: performance?.toolExecutionMs, outputTokensPerSecond: performance?.outputTokensPerSecond } },
              });
            },
            onToolExecutionStart: ({ callId, toolCall }) => {
              if (!ports.isCurrent()) return;
              const name = toolCall?.toolName || 'tool';
              if (name === 'reportProgress') {
                ports.onTool('');
                ports.onDisplayTool('');
                return;
              }
              const innerToolName = name === 'executeTool' ? toolCall?.input?.name : name;
              if (String(innerToolName || '').startsWith('computer')) ports.onComputerUse();
              const sourceCallId = callId || toolCall?.toolCallId || '';
              const eventKey = `${sourceCallId || 'tool'}:${++executionSequence}`;
              const queueKey = `${sourceCallId}|${name}`;
              executionCallQueues.set(queueKey, [...(executionCallQueues.get(queueKey) || []), eventKey]);
              const nextEvent = { id: eventKey, callId: eventKey, sourceCallId, name, input: toolCall?.input || {}, output: { status: 'running' }, startedAt: Date.now(), durationMs: null, at: new Date().toISOString() };
              assistantTools = [...assistantTools, nextEvent];
              assistantTimeline = [...assistantTimeline, { type: 'tool', id: nextEvent.id, name, input: nextEvent.input, status: 'running' }];
              ports.onTool(name);
              ports.onDisplayTool(String(innerToolName || name));
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.start', input: { callId: eventKey, sourceCallId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName, input: toolCall?.input }, output: { status: 'started' } });
            },
            onToolExecutionEnd: ({ callId, toolCall, toolExecutionMs, toolOutput }) => {
              if (!ports.isCurrent()) return;
              if (toolCall?.toolName === 'reportProgress') return;
              const toolResult = toolOutput?.output ?? toolOutput?.result ?? toolOutput;
              const toolStatus = toolOutput?.type === 'tool-result' && toolResult?.ok !== false ? 'completed' : 'error';
              const sourceCallId = callId || toolCall?.toolCallId || '';
              const name = toolCall?.toolName || 'tool';
              const queueKey = `${sourceCallId}|${name}`;
              const queuedKeys = executionCallQueues.get(queueKey) || [];
              const eventKey = queuedKeys.shift() || '';
              if (queuedKeys.length) executionCallQueues.set(queueKey, queuedKeys); else executionCallQueues.delete(queueKey);
              if (eventKey) {
                const output = toolOutput?.type === 'tool-result' ? toolResult : { ok: false, error: String(toolOutput?.error?.message || toolOutput?.error || 'TOOL_EXECUTION_FAILED').slice(0, 4000), errorType: toolOutput?.error?.name || 'Error' };
                assistantTools = assistantTools.map((event) => event.callId === eventKey ? { ...event, output, durationMs: toolExecutionMs } : event);
                const toolEvent = assistantTools.find((event) => event.callId === eventKey);
                if (toolEvent) assistantTimeline = assistantTimeline.map((event) => event.id === toolEvent.id ? { ...event, status: toolStatus, output, durationMs: toolExecutionMs } : event);
              }
              updateAssistantMessage();
              void appendExecutionLog({ projectPath: contextProjectPath, chatId: chat?.chatId, tool: 'tool.execution.end', input: { callId: eventKey || `${sourceCallId}:unmatched`, sourceCallId, toolCallId: toolCall?.toolCallId, toolName: toolCall?.toolName }, output: { durationMs: toolExecutionMs, status: toolStatus } });
            },
            onToolCall: () => {
              if (!ports.isCurrent()) return;
              if (toolStateTimer) clearTimeout(toolStateTimer);
              ports.onState('tool_call');
            },
            onToolResult: () => {
              if (!ports.isCurrent()) return;
              if (toolStateTimer) clearTimeout(toolStateTimer);
              toolStateTimer = setTimeout(() => {
                toolStateTimer = null;
                if (!ports.isCurrent() || abortController.signal.aborted) return;
                ports.onState('streaming');
                ports.onDisplayTool('');
              }, 2000);
            },
            onUsage: async (usage) => {
              const record: GenerationUsageRecord = {
                id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                at: new Date().toISOString(),
                projectPath: contextProjectPath,
                chatId: chat?.chatId || '',
                mode: runMode,
                provider: currentProvider.label || currentProvider.id,
                model: usage.model || currentModel.label || currentModel.id,
                inputTokens: usage.inputTokens ?? null,
                outputTokens: usage.outputTokens ?? null,
                totalTokens: usage.totalTokens ?? null,
                reasoningTokens: usage.reasoningTokens ?? null,
                inputCostPerMillion: Number.isFinite(Number(currentModel.cost?.input)) ? Number(currentModel.cost?.input) : null,
                outputCostPerMillion: Number.isFinite(Number(currentModel.cost?.output)) ? Number(currentModel.cost?.output) : null,
                durationMs: usage.durationMs,
                status: 'completed',
              };
              if (ports.isCurrent()) latestUsage = record;
              void appendGenerationUsage(record).catch((error) => {
                console.error('No se pudo guardar el uso de tokens:', error);
              });
            },
          },
        });
      };
      assistantContent = await runAssistant();
      const structuredSummary = formatArtifactOutput(structuredArtifactOutput);
      if (structuredSummary) assistantContent = structuredSummary;
      if (!abortController.signal.aborted && !assistantContent?.trim()) {
        const toolFallback = formatToolExecutionFallback(runMode, routeSpecialist, assistantTools);
        if (toolFallback) assistantContent = toolFallback;
        else {
          ports.onState('streaming');
          assistantContent = await runAssistant();
          const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
          if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        }
      }
      if (!assistantContent?.trim()) throw new Error(translate('chatInterface.theModelDidNotReturnAResponseAfterRetrying', language));

      let lastContinuationSignature = '';
      const initialSwarmEvents = assistantTools.filter((event) => event.name === 'swarm');
      const initialSwarmActions = initialSwarmEvents.map((event) => event.input?.action).filter(Boolean);
      const activeSwarmName = initialSwarmEvents.map((event) => event.output?.swarmName || event.input?.swarmName).find(Boolean) || '';
      const activeChildNames = initialSwarmEvents.map((event) => event.output?.childName || event.input?.childName).filter(Boolean);
      let swarmOpen = initialSwarmActions.includes('spawn') && !initialSwarmActions.includes('merge') && !initialSwarmActions.includes('stop');
      while (!abortController.signal.aborted) {
        const swarmEvents = assistantTools.filter((event) => event.name === 'swarm');
        const actions = swarmEvents.map((event) => event.input?.action).filter(Boolean);
        if (!swarmOpen || actions.includes('merge') || actions.includes('stop')) break;
        const signature = actions.join('|');
        const hasProgressAction = actions.some((action) => ['sendMessage', 'broadcast', 'wait'].includes(action));
        if ((signature && signature === lastContinuationSignature) || actions.includes('spawn') || !hasProgressAction) break;
        const evidence = swarmEvents.slice(-8).map((event) => ({ input: event.input, output: event.output })).filter((event) => event.output?.status !== 'running');
        lastContinuationSignature = signature;
        assistantContent = await runAssistant(`Continuá el swarm ${activeSwarmName || 'activo'} existente con los hijos ${JSON.stringify(activeChildNames)}. No uses spawn: comunicá, esperá y luego ejecutá merge o stop. Evidencias: ${JSON.stringify(evidence).slice(0, 3000)}`);
        const retryStructuredSummary = formatArtifactOutput(structuredArtifactOutput);
        if (retryStructuredSummary) assistantContent = retryStructuredSummary;
        const continuationActions = assistantTools.filter((event) => event.name === 'swarm').map((event) => event.input?.action).filter(Boolean);
        if (continuationActions.includes('merge') || continuationActions.includes('stop')) swarmOpen = false;
      }

      if (!ports.isCurrent() || abortController.signal.aborted) return;
      const changes = contextProjectPath ? summarizeWorkspaceDelta(beforeWorkspaceSnapshot, await readWorkspaceSnapshot(toolProjectPath)) : null;
      const { summary: turnSummary } = await generateTurnSummary({ model: provider(selectedModelReference) as any, request: visibleContent || content, response: assistantContent, language, signal: abortController.signal, projectPath: contextProjectPath || '', chatId, providerId: currentProvider.id, modelId: currentModel.id });
      if (!ports.isCurrent()) return;
      const assistantMessage = { turnSummary, historyIndex: userMessage.historyIndex+1, role: 'assistant', content: assistantContent || translate('chatInterface.theRunFinishedWithoutFinalTextButItsEvidence', language), progress: assistantProgress, timeline: assistantTimeline, tools: assistantTools, agentName: 'Desarrollo', meta: { modelCalls, provider: currentProvider.label || currentProvider.id, model: currentModel.label || currentModel.id, durationMs: Date.now() - executionStartedAt, status: 'completed', changes, usage: latestUsage ? { inputTokens: latestUsage.inputTokens, outputTokens: latestUsage.outputTokens, totalTokens: latestUsage.totalTokens, reasoningTokens: latestUsage.reasoningTokens } : null } };
      if (assistantUpdateFrame !== null) {
        ports.cancelFrame(assistantUpdateFrame);
        assistantUpdateFrame = null;
      }
      return { assistantMessages: assistantBubbles(assistantMessage), turnSummary };
  } finally {
    if (assistantUpdateFrame !== null) ports.cancelFrame(assistantUpdateFrame);
    if (toolStateTimer) clearTimeout(toolStateTimer);
    await pluginMcpClose?.().catch(() => undefined);
  }
}
