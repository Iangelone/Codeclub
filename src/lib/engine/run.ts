/** Shared model loop for chats, scheduled runs, and helper calls: LangGraph controls continuation while AI SDK streams each step. */
import { asSchema, pruneMessages, smoothStream, stepCountIs, ToolLoopAgent, type ModelMessage } from 'ai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { tool as langchainTool } from 'langchain';
import { contextBytes, messageContextCost } from '../chat-context';
import type { EngineCallbacks, ModelCallMetrics } from './types';
import { getDiscoveredTools, compactToolSchemas } from './tool-discovery';
import { compactBrowserContext, type BrowserContextStats } from './browser-context';

type RunStreamArgs = {
  model: any;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, any>;
  structuredOutput?: any;
  maxOutputTokens?: number;
  contextWindow?: number;
  callbacks: EngineCallbacks;
  signal?: AbortSignal;
  providerOptions?: Record<string, any>;
  maxSteps?: number;
  maxTotalTokens?: number;
};

async function runStreamInternal({ model, system, messages, tools, structuredOutput, maxOutputTokens, contextWindow, callbacks, signal, providerOptions, maxSteps, maxTotalTokens }: RunStreamArgs): Promise<string> {
  let content = '';
  let reasoning = '';
  let streamError: unknown;
  const startedAt = Date.now();
  const steps: any[] = [];
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 };
  let responseModel: string | undefined;
  const limit = Math.max(1, Math.min(128, Math.floor(Number.isFinite(maxSteps) ? maxSteps! : 8)));
  const adaptedTools = await adaptLangChainTools(tools);
  const activeSchemas = new Map<string, unknown>();
  const State = Annotation.Root({
    messages: Annotation<ModelMessage[]>(),
    stepCount: Annotation<number>(),
    continueRun: Annotation<boolean>(),
    retries: Annotation<number>(),
    contextStats: Annotation<BrowserContextStats>(),
  });
  const checkAbort = () => {
    if (signal?.aborted) {
      const error = new Error('Generación cancelada por el usuario.');
      error.name = 'AbortError';
      throw error;
    }
  };
  const graph = new StateGraph(State)
    .addNode('prepare', async (state) => {
      checkAbort();
      const currentTools = getDiscoveredTools(tools);
      const added = Object.fromEntries(Object.entries(currentTools).filter(([name]) => !adaptedTools[name]));
      Object.assign(adaptedTools, await adaptLangChainTools(added));
      for (const [name, definition] of Object.entries(currentTools)) {
        if (!activeSchemas.has(name)) activeSchemas.set(name, await asSchema(definition.inputSchema).jsonSchema);
      }
      const catalogContext = compactToolSchemas(state.messages, activeSchemas);
      const browserContext = compactBrowserContext(catalogContext.messages);
      browserContext.stats.beforeBytes = new TextEncoder().encode(JSON.stringify(state.messages)).length;
      browserContext.stats.schemasCompacted = catalogContext.schemasCompacted;
      const preparedMessages = browserContext.messages;
      const windowSize = Number.isFinite(contextWindow) && contextWindow! > 0 ? contextWindow! : 32768;
      const budget = Math.max(1024, Math.floor(windowSize * 0.75));
      const overhead = contextBytes(system) + contextBytes(JSON.stringify(Object.entries(currentTools).map(([name, tool]) => ({ name, description: tool.description, schema: activeSchemas.get(name) })))) + Math.min(maxOutputTokens || 4096, Math.floor(budget / 4));
      const cost = (items: ModelMessage[]) => overhead + items.reduce((sum, message) => sum + messageContextCost(message), 0);
      if (cost(preparedMessages) <= budget) return { messages: preparedMessages, contextStats: browserContext.stats };
      let compacted = pruneMessages({ messages: preparedMessages, reasoning: 'all', toolCalls: 'before-last-3-messages', emptyMessages: 'remove' });
      // Discovered tool schemas also consume context. Preserve the latest request
      // and its tool chain while dropping older complete turns when necessary.
      while (cost(compacted) > budget) {
        const nextUser = compacted.findIndex((message, index) => index > 0 && message.role === 'user');
        if (nextUser < 0) break;
        compacted = compacted.slice(nextUser);
      }
      if (cost(compacted) > budget) throw new Error('CHAT_MESSAGE_TOO_LARGE');
      return { messages: compacted, contextStats: browserContext.stats };
    })
    .addNode('model', async (state) => {
      checkAbort();
      const contentBefore = content;
      const reasoningBefore = reasoning;
      let stepHasText = false;
      let requestedTool = false;
      streamError = undefined;
      const callStartedAt = Date.now();
      const callMetric = { callId: crypto.randomUUID(), stepNumber: state.stepCount, attempt: state.retries + 1, startedAt: new Date(callStartedAt).toISOString(), context: state.contextStats };
      let metricReported = false;
      let performance: any;
      const reportMetric = async (metrics: Partial<ModelCallMetrics> & { status: ModelCallMetrics['status'] }) => {
        metricReported = metrics.status !== 'started';
        await callbacks.onModelCall?.({ ...callMetric, durationMs: Date.now() - callStartedAt, ...metrics });
      };
      await reportMetric({ status: 'started' });
      try {
        // One SDK step per graph node. SDK still owns transport and tool events;
        // conditional edges own continuation, without replaying earlier effects.
        const agent = new ToolLoopAgent({
          model, instructions: system, tools: adaptedTools,
          ...(providerOptions ? { providerOptions } : {}),
          telemetry: { isEnabled: false },
          stopWhen: stepCountIs(1),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(structuredOutput ? { output: structuredOutput } : {}),
        });
        const result = await agent.stream({
          messages: state.messages,
          abortSignal: signal,
          experimental_transform: smoothStream(),
          onStepEnd: async (info: any) => {
            performance = info.performance;
            await callbacks.onStepEnd?.({ ...info, stepNumber: state.stepCount, toolCalls: info.toolCalls, toolResults: info.toolResults });
          },
          onToolExecutionStart: async (info: any) => {
            await callbacks.onToolExecutionStart?.(info);
          },
          onToolExecutionEnd: async (info: any) => {
            await callbacks.onToolExecutionEnd?.(info);
          },
        });

        // `fullStream` carries text, reasoning, and tool events through one stream.
        for await (const chunk of result.fullStream as AsyncIterable<any>) {
          if (chunk.type === 'text-delta') {
            const delta = chunk.text ?? '';
            if (delta && !stepHasText) {
              if (content && !structuredOutput) content += '\n\n';
              callbacks.onAssistantMessageStart?.(content.length);
              stepHasText = true;
            }
            content += delta;
            if (!structuredOutput) callbacks.onTextDelta(content);
          } else if (chunk.type === 'reasoning-delta') {
            reasoning += chunk.text ?? '';
            callbacks.onReasoningDelta?.(reasoning);
          } else if (chunk.type === 'tool-call' || chunk.type === 'tool-input-start') {
            requestedTool = true;
            callbacks.onToolCall?.();
          } else if (chunk.type === 'tool-result' || chunk.type === 'tool-error') {
            callbacks.onToolResult?.();
          } else if (chunk.type === 'error') {
            streamError ??= chunk.error;
          }
          checkAbort();
        }

        if (streamError != null) {
          await Promise.allSettled([result.usage, result.response]);
          const error = streamError as { name?: string; message?: string; statusCode?: number; responseHeaders?: Record<string, string> };
          const rateLimited = error.statusCode === 429 || /RateLimitError$/.test(error.name || '');
          const temporarilyUnavailable = [500, 502, 503, 504].includes(error.statusCode ?? 0) || /service temporarily unavailable/i.test(error.message || '');
          if (!requestedTool && state.retries < 2 && (rateLimited || temporarilyUnavailable)) {
            const retryAfter = Number(error.responseHeaders?.['retry-after']);
            const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : (rateLimited ? 30000 : 1000) * (state.retries + 1);
            await reportMetric({ status: 'retrying', errorName: error.name || 'Error', retryDelayMs: Math.min(delay, 60000) });
            content = contentBefore;
            reasoning = reasoningBefore;
            if (!structuredOutput) callbacks.onTextDelta(content);
            callbacks.onReasoningDelta?.(reasoning);
            await new Promise<void>((resolve, reject) => {
              const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason || new Error('Generation cancelled')); };
              const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(delay, 60000));
              signal?.addEventListener('abort', abort, { once: true });
              if (signal?.aborted) abort();
            });
            checkAbort();
            return { continueRun: true, retries: state.retries + 1 };
          }
          callbacks.onError?.(streamError);
          throw streamError;
        }

        if (structuredOutput) {
          await callbacks.onStructuredOutput?.(await result.output);
        }

        checkAbort();

        const [usage, response, responseMessages, stepResults] = await Promise.all([result.usage, result.response, result.responseMessages, result.steps]);
        await reportMetric({ status: 'completed', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens, timeToFirstOutputMs: performance?.timeToFirstOutputMs, responseTimeMs: performance?.responseTimeMs, toolExecutionMs: performance?.toolExecutionMs });
        steps.push(...stepResults.map((step) => ({ ...step, stepNumber: state.stepCount, toolCalls: step.toolCalls, toolResults: step.toolResults })));
        callbacks.onStepUsage?.(usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
        totalUsage.inputTokens += usage.inputTokens ?? 0;
        totalUsage.outputTokens += usage.outputTokens ?? 0;
        totalUsage.totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        totalUsage.reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0;
        if (maxTotalTokens && totalUsage.totalTokens >= maxTotalTokens) throw new Error('TASK_BUDGET_EXCEEDED');
        responseModel = response.modelId;
        const last = stepResults.at(-1);
        // Only continue when every requested tool actually produced a result.
        // Provider-executed/deferred tools and approval requests cannot be replayed.
        const calls = last?.toolCalls ?? [];
        const results = last?.content.filter(part => part.type === 'tool-result' || part.type === 'tool-error') ?? [];
        const continueRun = calls.length > 0 && calls.every((call) => results.some((result) => result.toolCallId === call.toolCallId));
        return { messages: [...state.messages, ...responseMessages], stepCount: state.stepCount + 1, continueRun, retries: 0 };
      } catch (error) {
        if (!metricReported || signal?.aborted) await reportMetric({ status: signal?.aborted ? 'aborted' : 'error', errorName: error instanceof Error ? error.name : 'Error' });
        throw error;
      }
    })
    .addNode('finish', async () => {
      checkAbort();
      await callbacks.onEnd?.({ steps, totalUsage });
      await callbacks.onUsage?.({ ...totalUsage, model: responseModel, durationMs: Date.now() - startedAt });
      return {};
    })
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'model')
    .addConditionalEdges('model', (state) => state.continueRun && state.stepCount < limit ? 'prepare' : 'finish', ['prepare', 'finish'])
    .addEdge('finish', END)
    .compile();
  try {
    await graph.invoke({ messages, stepCount: 0, continueRun: false, retries: 0 }, { signal, recursionLimit: limit * 6 + 3 });
  } catch (error) {
    if (signal?.aborted) await callbacks.onAbort?.({ steps });
    throw error;
  }
  return content;
}

/** Preserve SDK metadata/options while executing local tools through LangChain. */
export async function adaptLangChainTools(tools: Record<string, any>): Promise<Record<string, any>> {
  const adapted: Record<string, any> = {};
  for (const [name, definition] of Object.entries(tools)) {
    if (typeof definition.execute !== 'function') {
      adapted[name] = definition;
      continue;
    }
    const schema = await asSchema(definition.inputSchema).jsonSchema;
    adapted[name] = {
      ...definition,
      execute: (input: unknown, options: any) => {
        options?.abortSignal?.throwIfAborted();
        const executable = langchainTool((arguments_: any) => {
          options?.abortSignal?.throwIfAborted();
          return definition.execute(arguments_, options);
        }, { name, description: definition.description || name, schema: schema as any, verboseParsingErrors: true });
        return executable.invoke(input as any, { signal: options?.abortSignal });
      },
    };
  }
  return adapted;
}

export async function runStream(args: RunStreamArgs): Promise<string> {
  const controller = new AbortController();
  const forwardAbort = () => {
    if (!controller.signal.aborted) controller.abort(args.signal?.reason);
  };
  args.signal?.addEventListener('abort', forwardAbort, { once: true });
  if(args.signal?.aborted)forwardAbort();

  const streamPromise = runStreamInternal({ ...args, signal: controller.signal });
  try {
    return await streamPromise;
  } finally {
    args.signal?.removeEventListener('abort', forwardAbort);
    if (!controller.signal.aborted) controller.abort();
    void streamPromise.catch(() => undefined);
  }
}
