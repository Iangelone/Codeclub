import type { ModelMessage } from 'ai';

const sources = new WeakMap<object, () => Record<string, any>>();

/** Session-local definitions discovered by a tool; no provider or task-specific routing. */
export function registerToolDiscovery(source: object, definitions: () => Record<string, any>) {
  sources.set(source, definitions);
}

export function getDiscoveredTools(base: Record<string, any>): Record<string, any> {
  const discovered: Record<string, any> = {};
  for (const definition of Object.values(base)) {
    const read = definition && typeof definition === 'object' ? sources.get(definition) : undefined;
    if (read) Object.assign(discovered, read());
  }
  return { ...discovered, ...base };
}

/** A schema already exposed as a callable tool need not be replayed in catalog results.
 * Only exact matching definitions are compacted; original results and actions stay intact.
 */
export function compactToolSchemas(messages: ModelMessage[], schemas: Map<string, unknown>): { messages: ModelMessage[]; schemasCompacted: number } {
  let schemasCompacted = 0;
  const next = messages.map(message => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== 'tool-result' || part.toolName !== 'searchTools' || !['json', 'text'].includes(part.output.type)) return part;
      const output = part.output as { type: 'json' | 'text'; value: any };
      let value = output.value;
      if (output.type === 'text') { try { value = JSON.parse(value); } catch { return part; } }
      if (!value || value.ok === false || !Array.isArray(value.tools)) return part;
      let changed = false;
      const tools = value.tools.map((entry: any) => {
        if (!entry || typeof entry.name !== 'string' || !entry.schema || !schemas.has(entry.name) || JSON.stringify(entry.schema) !== JSON.stringify(schemas.get(entry.name))) return entry;
        const { schema, ...metadata } = entry;
        schemasCompacted += 1;
        changed = true;
        return { ...metadata, schemaInToolDefinition: true };
      });
      if (!changed) return part;
      const compacted = { ...value, tools };
      return { ...part, output: { ...part.output, value: output.type === 'text' ? JSON.stringify(compacted) : compacted } } as typeof part;
    }) } as ModelMessage;
  });
  return { messages: next, schemasCompacted };
}
