import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

type Message = Record<string, any>;
export class ChatStore {
  private db: DatabaseSync;
  private importing = new Map<string, Promise<void>>();
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'chats.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS chats(scope TEXT NOT NULL, id TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS messages(scope TEXT NOT NULL,id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL, PRIMARY KEY(scope,id,seq));
      CREATE TABLE IF NOT EXISTS memories(scope TEXT NOT NULL,id TEXT NOT NULL,end INTEGER NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(scope,id));`);
  }
  private scope(project: string) { return project ? path.resolve(project).toLowerCase() : ''; }
  private check(id: string) { if (typeof id !== 'string' || !id || id.length > 300) throw new Error('Invalid chat ID'); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Runs before renderers start. Only remove legacy keys after durable import. */
  migrateGlobalSettings() {
    const file = path.join(this.directory, 'settings.json');
    if (!existsSync(file)) return;
    let settings: Record<string, any>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      settings = parsed as Record<string, any>;
    } catch {
      return;
    }
    const histories = settings.codeclub_global_chat_histories;
    const transcripts = settings.codeclub_global_chat_transcripts;
    if (!histories && !transcripts) return;
    this.transaction(() => {
      for (const [id, messages] of Object.entries(histories || {})) {
        if (!Array.isArray(messages) || !id || id.length > 300 || this.has('', id)) continue;
        this.replaceSync('', id, 0, messages.filter((message): message is Message => Boolean(message) && typeof message === 'object' && !Array.isArray(message)));
      }
    });
    const transcriptEntries = transcripts && typeof transcripts === 'object' && !Array.isArray(transcripts) ? Object.entries(transcripts) : [];
    for (const [id, content] of transcriptEntries) {
      if (!id || id.length > 300 || typeof content !== 'string') continue;
      const target = this.transcriptFile('', id);
      if (!existsSync(target)) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, String(content), 'utf8'); }
    }
    delete settings.codeclub_global_chat_histories;
    delete settings.codeclub_global_chat_transcripts;
    writeFileSync(`${file}.chat-migration.tmp`, JSON.stringify(settings), 'utf8');
    renameSync(`${file}.chat-migration.tmp`, file);
  }
  private has(scope: string, id: string) { return Boolean(this.db.prepare('SELECT 1 FROM chats WHERE scope=? AND id=?').get(scope,id)); }
  private async ensure(project: string, id: string) {
    this.check(id);
    const scope = this.scope(project);
    const key = JSON.stringify([scope,id]);
    if (this.importing.has(key)) return this.importing.get(key);
    if (this.has(scope,id)) return;
    const pending = (async () => {
      const candidates = project ? [
        path.join(this.directory,'chat-history',encodeURIComponent(project),`${encodeURIComponent(id)}.jsonl`),
        ...(!/[\\/]/.test(id) ? [path.join(this.directory,'projects',encodeURIComponent(project),'chats',`${id}.jsonl`)] : []),
      ] : [];
      // Older fallback IDs are filenames: never allow path traversal during import.
      const file = candidates.find(candidate => candidate.startsWith(this.directory + path.sep) && existsSync(candidate));
      let seq = 0;
      try {
        if (file) {
          const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
          let batch: Message[] = [];
          const flush = () => { this.transaction(() => { const insert=this.db.prepare('INSERT OR REPLACE INTO messages VALUES(?,?,?,?)'); for(const message of batch) insert.run(scope,id,seq++,JSON.stringify(message)); }); batch=[]; };
          for await (const line of lines) { if (!line.trim()) continue; batch.push(JSON.parse(line)); if(batch.length===100) flush(); }
          if(batch.length) flush();
        }
        this.db.prepare('INSERT INTO chats VALUES(?,?,?)').run(scope,id,seq);
      } catch(error) { this.db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(scope,id); throw error; }
    })();
    this.importing.set(key,pending);
    try { await pending; } finally { this.importing.delete(key); }
  }
  async page(project: string,id: string,before?: number,limit=80) {
    await this.ensure(project,id);
    const scope=this.scope(project);
    const total=Number(this.db.prepare('SELECT total FROM chats WHERE scope=? AND id=?').get(scope,id)!.total);
    const safeBefore = typeof before === 'number' && Number.isFinite(before) ? Math.floor(before) : total;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 80;
    const end=before===undefined ? total : Math.max(0,Math.min(total,safeBefore));
    const start=Math.max(0,end-safeLimit);
    const rows=this.db.prepare('SELECT seq,payload FROM messages WHERE scope=? AND id=? AND seq>=? AND seq<? ORDER BY seq').all(scope,id,start,end);
    return { messages:rows.map(row => ({...JSON.parse(String(row.payload)), historyIndex:Number(row.seq)})), start,total };
  }
  /** Reads a chat window by complete user turns while keeping message sequence cursors. */
  async turnPage(project: string,id: string,before?: number,limit=15,direction:'before'|'after'='before') {
    await this.ensure(project,id);
    const scope=this.scope(project);
    const total=Number(this.db.prepare('SELECT total FROM chats WHERE scope=? AND id=?').get(scope,id)!.total);
    const turnLimit=Math.max(1,Math.min(200,Math.floor(limit)));
    let start:number;
    let end:number;
    if(direction==='after') {
      start=Math.max(0,Math.min(total,Math.floor(before ?? total)));
      const lastTurn=this.db.prepare("SELECT seq FROM messages WHERE scope=? AND id=? AND seq>=? AND json_extract(payload,'$.role')='user' ORDER BY seq LIMIT 1 OFFSET ?").get(scope,id,start,turnLimit-1);
      if(lastTurn) {
        const nextTurn=this.db.prepare("SELECT seq FROM messages WHERE scope=? AND id=? AND seq>? AND json_extract(payload,'$.role')='user' ORDER BY seq LIMIT 1").get(scope,id,Number(lastTurn.seq));
        end=nextTurn?Number(nextTurn.seq):total;
      } else end=total;
    } else {
      end=before===undefined?total:Math.max(0,Math.min(total,Math.floor(before)));
      const firstTurn=this.db.prepare("SELECT seq FROM messages WHERE scope=? AND id=? AND seq<? AND json_extract(payload,'$.role')='user' ORDER BY seq DESC LIMIT 1 OFFSET ?").get(scope,id,end,turnLimit-1);
      start=firstTurn?Number(firstTurn.seq):0;
    }
    const rows=this.db.prepare('SELECT seq,payload FROM messages WHERE scope=? AND id=? AND seq>=? AND seq<? ORDER BY seq').all(scope,id,start,end);
    return {messages:rows.map(row=>({...JSON.parse(String(row.payload)),historyIndex:Number(row.seq)})),start,total};
  }
  private replaceSync(scope:string,id:string,start:number,messages:Message[]) {
    this.db.prepare('DELETE FROM memories WHERE scope=? AND id=? AND end>?').run(scope,id,start);
    this.db.prepare('DELETE FROM messages WHERE scope=? AND id=? AND seq>=?').run(scope,id,start);
    const insert=this.db.prepare('INSERT INTO messages VALUES(?,?,?,?)');
    messages.forEach((message,index)=>{const {historyIndex,...stored}=message; insert.run(scope,id,start+index,JSON.stringify(stored));});
    this.db.prepare('INSERT INTO chats VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET total=excluded.total').run(scope,id,start+messages.length);
  }
  async saveTail(project:string,id:string,start:number,messages:Message[],expectedTotal?:number) {
    await this.ensure(project,id);
    const scope=this.scope(project);
    const total=Number(this.db.prepare('SELECT total FROM chats WHERE scope=? AND id=?').get(scope,id)!.total);
    if(expectedTotal!==undefined&&expectedTotal!==total)throw new Error('CHAT_HISTORY_CONFLICT');
    if(!Number.isSafeInteger(start)||start<0||start>total||!Array.isArray(messages)||messages.some(message=>!message||typeof message!=='object'||Array.isArray(message))) throw new Error('Invalid history range');
    this.transaction(()=>this.replaceSync(scope,id,start,messages));
    return start+messages.length;
  }
  async append(project:string,id:string,message:Message) {
    await this.ensure(project,id);
    const scope=this.scope(project);
    return this.transaction(()=>{
      const total=Number(this.db.prepare('SELECT total FROM chats WHERE scope=? AND id=?').get(scope,id)!.total);
      if(Number.isSafeInteger(message.historyIndex)&&message.historyIndex!==total)throw new Error('CHAT_HISTORY_CONFLICT');
      this.replaceSync(scope,id,total,[message]);
      return total+1;
    });
  }
  hasMessages(project: string, id: string) { return Boolean(this.db.prepare('SELECT 1 FROM messages WHERE scope=? AND id=? LIMIT 1').get(this.scope(project), id)); }
  async all(project:string,id:string) {
    await this.ensure(project,id);
    return this.db.prepare('SELECT payload FROM messages WHERE scope=? AND id=? ORDER BY seq').all(this.scope(project),id).map(row=>JSON.parse(String(row.payload)));
  }
  async context(project:string,id:string) {
    const page=await this.page(project,id,undefined,80);
    const scope=this.scope(project);
    const memory=this.db.prepare('SELECT end,summary FROM memories WHERE scope=? AND id=?').get(scope,id);
    let end=Number(memory?.end||0),summary=String(memory?.summary||'');
    // Bound each query and the persisted extractive memory; full history stays searchable.
    const maxSummaryMessages = 500;
    if (page.start - end > maxSummaryMessages) {
      if (!summary) summary = '[Older messages omitted; use searchChats for exact history.]\n';
      end = page.start - maxSummaryMessages;
    }
    while(end<page.start) {
      const rows=this.db.prepare('SELECT seq,payload FROM messages WHERE scope=? AND id=? AND seq>=? AND seq<? ORDER BY seq LIMIT 100').all(scope,id,end,page.start);
      if(!rows.length) break;
      for(const row of rows) { const message=JSON.parse(String(row.payload)); const text=String(message.displayContent||message.content||'').replace(/\s+/g,' ').slice(0,300); if(text) summary+=`\n[${row.seq}] ${message.role}: ${text}`; end=Number(row.seq)+1; }
      if(summary.length>6000) summary=summary.slice(0,1000)+'\n[Older excerpts omitted; use searchChats for full history.]\n'+summary.slice(-4800);
    }
    this.db.prepare('INSERT INTO memories VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET end=excluded.end,summary=excluded.summary').run(scope,id,end,summary);
    return {...page,summary};
  }
  async search(project:string,id:string,query:string) {
    await this.ensure(project,id);
    const needle = String(query || '').trim().slice(0, 250);
    if (!needle) return [];
    const pattern=`%${needle.replace(/[\\%_]/g,'\\$&')}%`;
    return this.db.prepare("SELECT payload FROM messages WHERE scope=? AND id=? AND (json_extract(payload,'$.content') LIKE ? ESCAPE '\\' OR json_extract(payload,'$.displayContent') LIKE ? ESCAPE '\\') ORDER BY seq DESC LIMIT 2").all(this.scope(project),id,pattern,pattern).map(row=>{const message=JSON.parse(String(row.payload));return String(message.displayContent||message.content||'').slice(0,500);});
  }
  async copy(from:string,to:string,id:string) {
    await this.ensure(from,id); await this.ensure(to,id);
    const source=this.scope(from),target=this.scope(to);
    if(source===target) return;
    this.transaction(()=>{
      this.db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(target,id);
      this.db.prepare('DELETE FROM memories WHERE scope=? AND id=?').run(target,id);
      this.db.prepare('INSERT INTO messages SELECT ?,id,seq,payload FROM messages WHERE scope=? AND id=?').run(target,source,id);
      this.db.prepare('UPDATE chats SET total=(SELECT total FROM chats WHERE scope=? AND id=?) WHERE scope=? AND id=?').run(source,id,target,id);
    });
  }
  async delete(project:string,id:string) {
    await this.ensure(project,id);
    // Keep an empty tombstone so preserved legacy JSONL cannot resurrect a deleted chat.
    this.transaction(()=>this.replaceSync(this.scope(project),id,0,[]));
  }
  private transcriptFile(project:string,id:string) { this.check(id); return path.join(this.directory,'chat-transcripts',encodeURIComponent(this.scope(project))||'global',`${encodeURIComponent(id)}.md`); }
  async transcript(project:string,id:string,markdown:string) { const file=this.transcriptFile(project,id); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.appendFile(file,markdown,'utf8'); }
  close(){this.db.close();}
}
