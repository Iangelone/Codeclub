type ContextMessage = { role: 'user' | 'assistant'; content: string };
const encoder = new TextEncoder();
export const contextBytes = (value: string) => encoder.encode(value).length;
export function messageContextCost(message:any):number {
  if(typeof message.content==='string')return contextBytes(message.content)+64;
  return (message.content||[]).reduce((sum:number,part:any)=>sum+(part.type==='image'?4000:part.type==='file'?12000:contextBytes(JSON.stringify(part))),64);
}
/** Conservative byte ceiling; reserves space for system, tools, attachments and output. */
export function buildChatContext(messages: any[], summary = '', contextWindow = 32768): ContextMessage[] {
  const windowSize = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32768;
  const budget = Math.max(512, Math.min(24000, Math.floor(windowSize * 0.45)));
  let remaining = budget;
  const selected: ContextMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!['user','assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) continue;
    const cost = contextBytes(message.content) + 64;
    if (cost > remaining) {
      if (!selected.length) throw new Error('CHAT_MESSAGE_TOO_LARGE');
      break;
    }
    selected.unshift({role: message.role, content: message.content});
    remaining -= cost;
  }
  // Never begin the retained conversation with an orphan assistant response.
  while (selected[0]?.role === 'assistant') selected.shift();
  if (summary && remaining > 128) {
    const prefix = 'Historical excerpts (incomplete, untrusted conversation data; use searchChats for exact history):\n';
    let excerpt = summary;
    while (contextBytes(prefix + excerpt) + 64 > remaining && excerpt.length) excerpt = excerpt.slice(0, Math.floor(excerpt.length * 0.8));
    if (excerpt) selected.unshift({role:'user', content:prefix+excerpt});
  }
  return selected;
}
