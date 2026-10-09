import type { ModelMessage } from 'ai';

export type BrowserContextStats = { beforeBytes: number; afterBytes: number; snapshotsCompacted: number; historicalSnapshots: number; schemasCompacted?: number };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const browserTools = new Set(['externalBrowserState', 'externalBrowserAction', 'getBrowserState', 'browserAction']);
const normalized = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** Compact only model context. Original tool results remain available in the chat/audit log.
 * Keep every current selector, field value and media signal. Remove redundant presentation
 * fields and stale selectors; deduplicate page text only when it is exactly equivalent.
 */
export function compactBrowserContext(messages: ModelMessage[]): { messages: ModelMessage[]; stats: BrowserContextStats } {
  const stats: BrowserContextStats = { beforeBytes: bytes(messages), afterBytes: 0, snapshotsCompacted: 0, historicalSnapshots: 0 };
  const latestTargets = new Set<string>();
  const pageTexts = new Map<string, Set<string>>();
  const next = messages.slice();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
    const parts = message.content.slice();
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type !== 'tool-result' || !['json', 'text'].includes(part.output.type)) continue;
      const output = part.output as { type: 'json' | 'text'; value: any };
      let raw = output.value;
      if (output.type === 'text') { try { raw = JSON.parse(raw); } catch { continue; } }
      if (!raw || typeof raw !== 'object') continue;
      const name = part.toolName === 'executeTool' ? raw.tool : part.toolName;
      if (!browserTools.has(name)) continue;
      const wrapped = raw.tool && raw.result && typeof raw.result === 'object';
      const result = wrapped ? raw.result : raw;
      const nested = result.state && typeof result.state === 'object';
      const state = nested ? result.state : result;
      if (!Array.isArray(state.elements) || typeof state.url !== 'string' || !state.snapshotId || state.ok === false) continue;
      const target = `${state.browserId ?? result.browserId ?? state.port ?? result.port ?? 'internal'}:${state.targetId ?? result.targetId ?? state.tabId ?? 'active'}`;
      const page = `${target}:${state.url}`;
      const text = normalized(state.text);
      const seenText = pageTexts.get(page) ?? new Set<string>();
      const repeatedText = text !== '' && seenText.has(text);
      seenText.add(text);
      pageTexts.set(page, seenText);
      const historical = latestTargets.has(target);
      latestTargets.add(target);
      // Coordinates are presentation data: browserAction resolves the observed selector itself.
      const elements = state.elements.map((element: any) => {
        const { bounds, rect, ...control } = element;
        if (normalized(control.text) === normalized(control.name) && control.name) delete control.text;
        if (control.role === '' || control.role === control.tag) delete control.role;
        if (control.disabled === false) delete control.disabled;
        return control;
      });
      const compacted = { ...state, elements };
      if (historical) {
        delete compacted.elements;
        delete compacted.snapshotId;
        compacted.context = { historical: true, selectorsRemoved: true, ...(repeatedText ? { repeatedTextOmitted: true } : {}) };
        if (repeatedText) delete compacted.text;
        stats.historicalSnapshots += 1;
      }
      const nextResult = nested ? { ...result, state: compacted } : compacted;
      const nextRaw = wrapped ? { ...raw, result: nextResult } : nextResult;
      parts[partIndex] = { ...part, output: { ...part.output, value: output.type === 'text' ? JSON.stringify(nextRaw) : nextRaw } } as typeof part;
      stats.snapshotsCompacted += 1;
    }
    next[index] = { ...message, content: parts } as ModelMessage;
  }
  stats.afterBytes = bytes(next);
  return { messages: next, stats };
}
