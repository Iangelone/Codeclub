'use client';

import { useEffect, useState } from 'react';
import { Clock, MessageSquare, Pause, Play } from 'lucide-react';
import type { ScheduledTask } from '../lib/scheduled-tasks';
import { sidebarTranslations, taskDetailsTranslations, useAppLanguage } from '../lib/i18n';

/** Displays a native scheduled task selected from Home; mutation updates arrive through the sidebar's task subscription. */
export default function TaskDetailsPanel({ task }: { task?: ScheduledTask }) {
  const language = useAppLanguage();
  const text = taskDetailsTranslations[language];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [task?.id, task?.projectPath]);
  const change = async (action: 'run' | 'toggle') => {
    if (!task || pending) return;
    setPending(true);
    setError('');
    try {
      const api = (window as any).codeclub;
      if (action === 'run') await api.tasksRun(task.projectPath, task.id);
      else await api.tasksSave(task.projectPath, { ...task, status: task.status === 'active' ? 'paused' : 'active' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : text.error); }
    finally { setPending(false); }
  };
  if (!task) return <section className="grid h-full place-items-center bg-[#161616] text-[13px] text-(--codeclub-text-muted)" aria-label={sidebarTranslations[language].tasks}>{sidebarTranslations[language].noTasks}</section>;
  const run = task.runs.at(-1);
  const running = task.runs.some(item => item.status === 'queued' || item.status === 'running');
  return <section className="h-full overflow-y-auto bg-[#161616] px-6 py-7" aria-label={task.name}>
    <div className="mx-auto max-w-[720px]">
      <div className="mb-5 flex items-center gap-2 text-[12px] text-(--codeclub-text-muted)"><Clock size={15} aria-hidden="true" />{sidebarTranslations[language].tasks}</div>
      <h1 className="m-0 text-[24px] font-semibold text-(--codeclub-text-strong)">{task.name}</h1>
      <p className="mt-2 text-[12px] text-(--codeclub-text-muted)">{task.status === 'active' ? text.active : text.paused} · {task.interval} · {task.interval === 'Personalizado' ? task.every : task.time}</p>
      <p className="mt-6 whitespace-pre-wrap text-[13px] leading-6 text-(--codeclub-text)">{task.prompt}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" disabled={pending || running} onClick={() => void change('run')} className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#2b2b2b] bg-[#202020] px-3 text-[12px] text-(--codeclub-text-strong) hover:bg-[#292929] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><Play size={14} aria-hidden="true" />{running ? text.running : text.runNow}</button>
        <button type="button" disabled={pending} onClick={() => void change('toggle')} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[12px] text-(--codeclub-text) hover:bg-[#202020] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)">{task.status === 'active' ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{task.status === 'active' ? text.pause : text.resume}</button>
        <button type="button" disabled={!run} onClick={() => { if (run) window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId: run.chatId, name: task.name, customName: true, projectPath: task.projectPath, projectName: task.projectPath.split(/[\\/]/).pop() || 'Codeclub' } })); }} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[12px] text-(--codeclub-text) hover:bg-[#202020] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><MessageSquare size={14} aria-hidden="true" />{text.openChat}</button>
      </div>
      {error && <p role="alert" className="mt-3 text-[12px] text-red-300">{error}</p>}
    </div>
  </section>;
}
