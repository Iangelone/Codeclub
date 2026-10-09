import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ChatStore } from '../electron-dist/chat-store.js';
import { buildChatContext, contextBytes } from '../src/lib/chat-context.ts';
import { boundChatWindow } from '../src/lib/chat-window.ts';

const directory=await mkdtemp(path.join(tmpdir(),'codeclub-chat-test-'));
let store;
try {
  const uneven=Array.from({length:603},(_,index)=>({role:index%3===0?'user':'assistant'}));
  for(const direction of ['older','newer']) {
    const window=boundChatWindow(uneven,direction);
    assert.ok(window.messages.length<=400);
    assert.equal(window.messages[0].role,'user');
    assert.equal(window.messages.length%3,0,'Window preserves ordinary turn boundaries');
  }
  const history=Array.from({length:10000},(_,index)=>({role:index%2?'assistant':'user',content:`Message ${index} ${'x'.repeat(80)}`,createdAt:index}));
  const project=path.resolve(directory,'project');
  const source=path.join(directory,'chat-history',encodeURIComponent(project),'long.jsonl');
  await mkdir(path.dirname(source),{recursive:true});
  await writeFile(source,history.map(message=>JSON.stringify(message)).join('\n'));
  await writeFile(path.join(directory,'settings.json'),JSON.stringify({language:'es',codeclub_global_chat_histories:{global:[{role:'user',content:'legacy global'}]},codeclub_global_chat_transcripts:{global:'legacy transcript'}}));
  store=new ChatStore(directory);
  store.migrateGlobalSettings();
  assert.equal((await store.page('','global')).messages[0].content,'legacy global');
  const settings=JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8'));
  assert.equal(settings.language,'es');assert.equal(settings.codeclub_global_chat_histories,undefined);
  store.migrateGlobalSettings(); // Idempotent after restart.
  const started=performance.now();
  const latest=await store.page(project,'long');
  const importMs=performance.now()-started;
  assert.equal(latest.total,10000);assert.equal(latest.start,9920);assert.equal(latest.messages.length,80);
  assert.equal((await store.page(project,'long',latest.start)).start,9840);
  const turns=await store.turnPage(project,'long',undefined,15);
  assert.equal(turns.messages.filter(message=>message.role==='user').length,15);
  assert.equal(turns.start,9970);
  const older=await store.turnPage(project,'long',turns.start,15);
  const newer=await store.turnPage(project,'long',older.start+older.messages.length,15,'after');
  assert.equal(newer.start,turns.start);assert.equal(newer.messages.length,turns.messages.length);
  for (const cursor of [NaN, Infinity, -Infinity]) {
    const page = await store.turnPage(project, 'long', cursor, NaN);
    assert.equal(page.start, turns.start);
    assert.equal(page.messages.length, turns.messages.length);
    assert.equal((await store.turnPage(project, 'long', cursor, NaN, 'after')).messages.length, 0);
  }
  assert.equal((await store.page(project.toUpperCase(),'long')).total,10000,'Windows project casing shares history');
  assert.equal((await store.page('','long')).total,0,'Global scope stays separate');
  const appendStarted=performance.now();
  await store.append(project,'long',{historyIndex:10000,role:'user',content:'new turn'});
  await assert.rejects(store.append(project,'long',{historyIndex:10000,role:'user',content:'stale window'}),/CHAT_HISTORY_CONFLICT/);
  const appendMs=performance.now()-appendStarted;
  assert.equal((await store.page(project,'long')).total,10001);
  await assert.rejects(store.saveTail(project,'long',9998,[{role:'user',content:'stale'}],10000),/CHAT_HISTORY_CONFLICT/);
  await store.saveTail(project,'long',9998,[{role:'user',content:'retried'},{role:'assistant',content:'new answer'}],10001);
  assert.equal((await store.page(project,'long',9998,1)).messages[0].content,history[9997].content,'Retry preserves older messages');
  assert.equal((await store.page(project,'long')).total,10000);
  await assert.rejects(store.saveTail(project,'long',10001,[]),/Invalid history range/);
  const cyclic={role:'user'};cyclic.self=cyclic;
  await assert.rejects(store.saveTail(project,'long',9998,[cyclic]));
  assert.equal((await store.page(project,'long')).messages.at(-1).content,'new answer','Transaction rolled back on serialization error');
  await store.copy(project,'','long');
  assert.equal((await store.page('','long')).total,10000);
  const context=await store.context(project,'long');
  assert.equal(context.messages.length,80);assert.ok(context.summary.length<=6000);
  assert.ok((await store.search(project,'long','Message 42')).length>0,'Older history remains searchable');
  assert.deepEqual(await store.search(project,'long','%_literal'),[],'Search does not interpret wildcard input');
  await store.transcript(project,'long','one\n');await store.transcript(project,'long','two\n');
  store.close();store=new ChatStore(directory);
  assert.equal((await store.page(project,'long')).messages.at(-1).content,'new answer','History survives reopening database');
  await store.delete(project,'long');
  store.close();store=new ChatStore(directory);
  assert.equal((await store.page(project,'long')).total,0,'Deleted legacy chat does not reappear');
  assert.ok((await readFile(source,'utf8')).includes('Message 0'),'Migration preserves source JSONL');
  await store.append('','unicode',{role:'user',content:'hola 😀'});
  const modelContext=buildChatContext(history,'old summary',8192);
  assert.ok(modelContext.length<history.length);
  assert.equal(modelContext.at(-1).content,history.at(-1).content);
  assert.ok(modelContext.reduce((total,message)=>total+contextBytes(message.content)+64,0)<=Math.floor(8192*.45));
  const unicode=buildChatContext([{role:'user',content:'😀'.repeat(300)}],'',4096);
  assert.equal(unicode.length,1);
  assert.throws(()=>buildChatContext([{role:'user',content:'x'.repeat(50000)}]),/CHAT_MESSAGE_TOO_LARGE/);
  console.log(JSON.stringify({passed:true,messages:10000,importMs:Math.round(importMs),appendMs:Math.round(appendMs),pageSize:80,contextMessages:modelContext.length}));
} finally {
  store?.close();
  const resolved=path.resolve(directory);
  if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('codeclub-chat-test-'))throw new Error('Unexpected test directory');
  await rm(resolved,{recursive:true,force:true});
}
