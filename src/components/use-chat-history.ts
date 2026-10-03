'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { boundChatWindow } from '../lib/chat-window';

const PAGE_TURN_COUNT = 15;
const WINDOW_SIZE = 400;
type Chat = { projectPath: string; chatId: string };
export function useChatHistory() {
  const [messages, rawSetMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const range = useRef({start:0,total:0});
  const current = useRef<Chat|null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const messagesRef = useRef<any[]>([]);
  useEffect(()=>()=>{epoch.current++;current.current=null;busy.current=false;},[]);
  const commit = useCallback((items:any[], start:number,total:number) => {
    range.current={start,total};
    const indexed=items.map((item,index)=>({...item,historyIndex:start+index}));
    messagesRef.current=indexed;
    rawSetMessages(indexed);
  },[]);
  const setMessages = useCallback((value:any[]|((previous:any[])=>any[])) => {
    const items=typeof value==='function'?value(messagesRef.current):value;
    const start=items[0]?.historyIndex ?? range.current.start;
    const bounded=boundChatWindow(items,'newer',WINDOW_SIZE);
    commit(bounded.messages,start+bounded.offset,Math.max(range.current.total,start+items.length));
  },[commit]);
  const reset = useCallback(() => {
    epoch.current++; current.current=null; busy.current=false;
    setLoading(false);setError(false);commit([],0,0);
  },[commit]);
  const open = useCallback(async (chat:Chat,fallback?:()=>Promise<any[]>) => {
    const request=++epoch.current; current.current=chat;busy.current=true;
    commit([],0,0);setLoading(true);setError(false);
    try {
      const bridge=(window as any).codeclub;
      const page=bridge?.chatTurns?await bridge.chatTurns(chat.projectPath,chat.chatId,undefined,PAGE_TURN_COUNT):await (async()=>{const all=await fallback?.()||[];const users=all.flatMap((message,index)=>message.role==='user'?[index]:[]);const start=users[Math.max(0,users.length-PAGE_TURN_COUNT)]??Math.max(0,all.length-PAGE_TURN_COUNT*2);return {messages:all.slice(start),start,total:all.length};})();
      if(request!==epoch.current) return false;
      const bounded=boundChatWindow(page.messages,'newer',WINDOW_SIZE);
      commit(bounded.messages,page.start+bounded.offset,page.total);return true;
    } catch { if(request===epoch.current)setError(true);return false; }
    finally {if(request===epoch.current){busy.current=false;setLoading(false);}}
  },[commit]);
  const adjacent = useCallback(async (direction:'older'|'newer') => {
    const chat=current.current,bridge=(window as any).codeclub;
    if(!chat||busy.current||!bridge?.chatTurns) return;
    const {start,total}=range.current,end=start+messagesRef.current.length;
    if(direction==='older'?start===0:end>=total)return;
    const request=epoch.current;busy.current=true;setLoading(true);setError(false);
    try {
      const page=await bridge.chatTurns(chat.projectPath,chat.chatId,direction==='older'?start:end,PAGE_TURN_COUNT,direction==='older'?'before':'after');
      if(request!==epoch.current)return;
      const rows=new Map<number,any>();
      for(const item of [...messagesRef.current,...page.messages])rows.set(item.historyIndex,item);
      const merged=[...rows.entries()].sort((a,b)=>a[0]-b[0]);
      const bounded=boundChatWindow(merged.map(row=>row[1]),direction,WINDOW_SIZE);
      commit(bounded.messages,merged[bounded.offset]?.[0]??0,page.total);
    }catch{if(request===epoch.current)setError(true);}
    finally{if(request===epoch.current){busy.current=false;setLoading(false);}}
  },[commit]);
  const restore = useCallback((chat:Chat,items:any[]) => {
    epoch.current++;current.current=chat;busy.current=false;setLoading(false);setError(false);
    const start=items[0]?.historyIndex??0;
    const bounded=boundChatWindow(items,'newer',WINDOW_SIZE);
    commit(bounded.messages,start+bounded.offset,start+items.length);
  },[commit]);
  return {messages,setMessages,loading,error,range,current,open,reset,restore,adjacent};
}
