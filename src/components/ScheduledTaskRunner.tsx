'use client';
import { getDesktopBridge } from '../lib/runtime';

import { useEffect, useRef, useState } from 'react';
import { executeScheduledTask } from '../lib/agent/scheduled-execution';
import { BrowserPanel } from './WorkspaceLayout';

/** Native ownership supplies the assignment; this component mounts the isolated browser surface. */
export default function ScheduledTaskRunner() {
  const started = useRef(false);
  const [chatId, setChatId] = useState<string>();
  useEffect(() => {
    if (started.current) return; started.current = true;
    void getDesktopBridge()?.taskAssignment?.().then((assignment: any) => setChatId(assignment?.run?.chatId));
    void executeScheduledTask().catch(() => { void getDesktopBridge()?.taskFinish('TASK_RUNNER_UNAVAILABLE').catch(() => undefined); });
  }, []);
  return <BrowserPanel isolated chatId={chatId} />;
}
