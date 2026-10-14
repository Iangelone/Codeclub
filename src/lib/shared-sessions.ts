'use client';
import { getDesktopBridge } from './runtime';

/** Subscribes renderer components to Electron-owned execution sessions and compares project/chat identity. */
import { useEffect, useState } from 'react';
import type { SessionView } from '../../shared/desktop-contracts';
export type SharedSession = SessionView;
export const sameSession = (a: {chatId:string;projectPath:string}|null, b: {chatId:string;projectPath:string}) => Boolean(a && a.chatId===b.chatId && a.projectPath.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase()===b.projectPath.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase());
export function useSharedSessions() {
  const [sessions,setSessions]=useState<SharedSession[]>([]);
  useEffect(()=>{
    const bridge=getDesktopBridge();
    let active=true, received=false;
    const unsubscribe=bridge?.onSessions?.((items:SharedSession[])=>{received=true;if(active)setSessions(items);});
    void bridge?.sessionList?.().then((items:SharedSession[])=>{if(active&&!received)setSessions(items);});
    return ()=>{active=false;unsubscribe?.();};
  },[]);
  return sessions;
}
