import { randomUUID } from 'node:crypto';

export type SessionChat = { chatId: string; projectPath: string; name?: string; projectName?: string };
export type SharedSession = SessionChat & { key: string; runId: string; owner: number; state: string; tool: string; busy: boolean; startedAt: number; updatedAt: number; messages: any[]; approvals: any[]; external?: boolean; url?: string };
export const sessionKey = (chat: SessionChat) => `${chat.projectPath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()}\n${chat.chatId}`;

/** Native authority for ownership and controls. Execution stays in its originating renderer. */
export class SessionHub {
  private sessions = new Map<string, SharedSession>();
  constructor(private changed: () => void = () => {}) {}
  private prune() {
    const completed=this.list().filter(entry=>!entry.busy);
    while(this.sessions.size>=100 && completed.length){const oldest=completed.pop()!;this.sessions.delete(oldest.key);}
  }
  list() { return [...this.sessions.values()].sort((a,b) => Number(b.busy)-Number(a.busy) || b.updatedAt-a.updatedAt).slice(0,100); }
  claim(owner: number, chat: SessionChat) {
    if (!chat?.chatId || chat.chatId.length > 200 || typeof chat.projectPath !== 'string') throw new Error('Invalid session');
    const key = sessionKey(chat), previous = this.sessions.get(key);
    if (previous?.busy) throw new Error('SESSION_ALREADY_RUNNING');
    this.prune();
    const runId = randomUUID();
    this.sessions.set(key, { ...chat, key, runId, owner, state:'connecting', tool:'', busy:true, startedAt:Date.now(), updatedAt:Date.now(), messages:[], approvals:[] });
    this.changed(); return runId;
  }
  publish(owner: number, chat: SessionChat, runId: string, update: Partial<SharedSession>) {
    const entry = this.sessions.get(sessionKey(chat));
    if (!entry || entry.owner !== owner || entry.runId !== runId) return false;
    entry.state = String(update.state || entry.state).slice(0,40);
    entry.tool = String(update.tool || '').slice(0,200);
    entry.busy = update.busy === true;
    if (Array.isArray(update.messages)) entry.messages = update.messages.slice(-80);
    if (Array.isArray(update.approvals)) entry.approvals = update.approvals.slice(0,20).filter(item => item.expiresAt > Date.now());
    entry.updatedAt = Date.now(); this.changed(); return true;
  }
  command(chat: SessionChat, action: string, approvalId?: string) {
    const entry = this.sessions.get(sessionKey(chat));
    if (!entry?.busy || !['cancel','approve','deny'].includes(action)) return null;
    if (action !== 'cancel' && !entry.approvals.some(item => item.id === approvalId && item.expiresAt > Date.now())) return null;
    if(action!=='cancel'){entry.approvals=entry.approvals.filter(item=>item.id!==approvalId);this.changed();}
    return { owner:entry.owner, runId:entry.runId, chat:{chatId:entry.chatId, projectPath:entry.projectPath}, action, approvalId };
  }
  disconnect(owner: number) {
    for (const entry of this.sessions.values()) if (entry.owner === owner && entry.busy) { entry.busy=false; entry.state='interrupted'; entry.approvals=[]; entry.updatedAt=Date.now(); }
    this.changed();
  }
  external(id: string, name: string, state: string, tool = '', url?: string) {
    const key=`external:${id}`;
    const previous=this.sessions.get(key);
    if(!previous)this.prune();
    this.sessions.set(key,{chatId:id,projectPath:'',name,key,owner:-1,runId:previous?.runId||randomUUID(),state,tool,busy:['working','thinking'].includes(state),startedAt:previous?.startedAt||Date.now(),updatedAt:Date.now(),messages:[],approvals:[],external:true,url});
    this.changed();
  }
}
