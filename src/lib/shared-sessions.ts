'use client';
import { useEffect, useState } from 'react';
export type SharedSession = { key: string; chatId: string; projectPath: string; projectName?: string; name?: string; state: string; tool: string; busy: boolean; startedAt: number; updatedAt: number; messages: any[]; approvals: any[]; localOwner?: boolean; external?: boolean; url?: string; runId: string };
export const sameSession = (a: {chatId:string;projectPath:string}|null, b: {chatId:string;projectPath:string}) => Boolean(a && a.chatId===b.chatId && a.projectPath.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase()===b.projectPath.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase());
export function useSharedSessions() {
  const [sessions,setSessions]=useState<SharedSession[]>([]);
  useEffect(()=>{
    const bridge=(window as any).codeclub;
    let active=true, received=false;
    const unsubscribe=bridge?.onSessions?.((items:SharedSession[])=>{received=true;if(active)setSessions(items);});
    void bridge?.sessionList?.().then((items:SharedSession[])=>{if(active&&!received)setSessions(items);});
    return ()=>{active=false;unsubscribe?.();};
  },[]);
  return sessions;
}
