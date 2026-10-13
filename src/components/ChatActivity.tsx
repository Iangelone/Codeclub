/** Turn progress, tool receipts, questions and approval presentation. */
import React, { useEffect, useState } from 'react';
import { ChevronDown, FileCode2, Terminal } from 'lucide-react';
import { useAppLanguage, type AppLanguage, getMessages, translate } from '../lib/i18n';

const formatProcessingDuration = (durationMs: number) => durationMs >= 60000 ? `${(durationMs / 60000).toFixed(1)}min` : `${Math.max(0, Math.round(durationMs / 1000))}s`;
const activityValue = (value: unknown, fallback = '') => String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, 90);
function activityToolInput(event: any): Record<string, any> {
  let input = event.name === 'executeTool' ? event.input?.input ?? event.input?.arguments ?? {} : event.input ?? {};
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return { input }; }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function activityToolOutput(value: any): any {
  // Timeline entries retain the SDK envelope; live tool entries already contain its output.
  for (let depth = 0; depth < 8 && value && typeof value === 'object'; depth += 1) {
    if (value.type === 'tool-result' && 'output' in value) value = value.output;
    else if (value.tool && 'result' in value) value = value.result;
    else break;
  }
  return value;
}

function activityConsoleText(value: unknown, truncatedLabel: string): string {
  if (value === undefined || value === null) return '';
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, (key, item) => /^(api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token)$/i.test(key) ? '[redacted]' : item, 2);
  } catch { text = String(value); }
  const limit = 24000;
  return text.length > limit ? `${text.slice(0, limit)}\n… ${truncatedLabel}` : text;
}

function toolActivityLabel(name: string, input: Record<string, any>, language: AppLanguage, completed = false) {
  const path = activityValue(input?.path || input?.filePath);
  const command = activityValue([input?.command, ...(Array.isArray(input?.args) ? input.args : [])].filter(Boolean).join(' '));
  const query = activityValue(input?.query);
  const url = activityValue(input?.url);
  const title = activityValue(input?.title || input?.name);
  const specialist = activityValue(input?.specialist);
  const action = activityValue(input?.action);
  const labels: Record<string, string> = getMessages('chatActivity', language).labels;

  const completedLabels: Record<string, string> = getMessages('chatActivity', language).completedLabels;
  const prefix = (completed ? completedLabels[name] : labels[name]) || (translate(completed ? 'chatActivity.actionCompleted' : 'chatActivity.working', language));
  const detail = name === 'runCommand' || name === 'terminal' ? command : name === 'readFile' || name === 'writeFile' ? path : name === 'searchText' ? query : name === 'openBrowser' ? url : name === 'createPlan' || name === 'todo' || name === 'createSkill' ? title : name === 'subagent' ? specialist : name === 'browserAction' || name === 'computerAction' ? action : '';
  return detail ? `${prefix} ${detail}` : prefix;
}

export function PyramidMark({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.7 14.1 13H1.9L8 1.7Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    <path d="m8 1.7 1.45 11.3M4.95 7.35h6.1" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
  </svg>;
}

function ToolActivityIcon({ name, size = 14, ...props }: { name: string; size?: number } & React.SVGProps<SVGSVGElement>) {
  // Purpose-drawn marks keep each tool recognizable without borrowing stock icon glyphs.
  const designs: Record<string, React.ReactNode> = {
    listFiles: <><path d="M2 3.2h8l3.2 3.1V13H2z"/><path d="M10 3.2v3.2h3.2M4.2 8.2h6.4M4.2 10.6h4.2"/></>,
    readFile: <><path d="M3 1.8h6.2l3.8 3.8v8.6H3z"/><path d="M9.2 1.8v3.8H13M5 8h5M5 10.5h5"/></>,
    searchText: <><circle cx="6.6" cy="6.6" r="4.2"/><path d="m9.7 9.7 4.1 4.1M4.8 6.6h3.6M6.6 4.8v3.6"/></>,
    searchTools: <><path d="M2.2 3.2h11.6M2.2 6.3h7.4M2.2 9.4h5.2M10.5 8.5l2.8 2.8M13.3 8.5l-2.8 2.8"/></>,
    executeTool: <><path d="m3 2.5 10 5.5-10 5.5z"/><path d="M5.2 5.3v5.4"/></>,
    scheduleTask: <><rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M5 2v3M11 2v3M2.5 6.2h11M5 8.5h2M9 8.5h2M5 10.8h2"/></>,
    listScheduledTasks: <><path d="M3 3h10v10H3z"/><path d="M5.2 5.5h5.6M5.2 8h5.6M5.2 10.5h3.1"/><circle cx="11.5" cy="11.5" r="1.2" fill="currentColor" stroke="none"/></>,
    manageScheduledTask: <><circle cx="8" cy="8" r="2.1"/><path d="m8 2.2.8 1.4 1.7.4.5-.7 1.4 1.4-.7.7.4 1.7 1.4.8v1.9l-1.4.8-.4 1.7.7.7-1.4 1.4-.7-.7-1.7.4-.8 1.4H6.1l-.8-1.4-1.7-.4-.7.7-1.4-1.4.7-.7-.4-1.7-1.4-.8V7.9l1.4-.8.4-1.7-.7-.7 1.4-1.4.7.7 1.7-.4.8-1.4z" transform="translate(1.1 0) scale(.86)"/></>,
    writeFile: <><path d="M2.5 11.6 10.9 3a1.7 1.7 0 0 1 2.4 2.4l-8.5 8.3-3 .7z"/><path d="m9.8 4.1 2.2 2.2"/></>,
    runCommand: <><path d="m3 4 3.3 3L3 10M7.5 11h5.3"/><path d="M2 2h12v12H2z"/></>,
    terminal: <><path d="M2 3h12v10H2z"/><path d="m4.2 6 2.2 2-2.2 2M7.7 10h3.7"/><circle cx="11.8" cy="5" r=".45" fill="currentColor" stroke="none"/></>,
    openBrowser: <><path d="M2 3h12v10H2z"/><path d="M2 5.5h12M4 4.2h.1M5.5 4.2h.1M5.1 11l2.1-3 2 2 1.6-1.5 2.1 2.5"/></>,
    getBrowserState: <><path d="M2.2 8s2.1-3.7 5.8-3.7S13.8 8 13.8 8s-2.1 3.7-5.8 3.7S2.2 8 2.2 8Z"/><circle cx="8" cy="8" r="1.6"/></>,
    browserAction: <><path d="M3 2.5v8.2h8.2"/><path d="m3.3 10.4 3.4-3.6 2.1 2 3.9-4"/><path d="M10 4.8h2.8v2.8"/></>,
    computerListWindows: <><rect x="2" y="2.2" width="8.6" height="7.1" rx=".7"/><path d="M4.2 12.4h4.2M6.3 9.3v3.1M8.3 4.3h5.6v7.1h-3.3"/></>,
    computerGetState: <><rect x="2.2" y="2.2" width="11.6" height="8.7" rx=".8"/><path d="M5 13.5h6M8 10.9v2.6M5 5.2h5.8M5 7.5h3.5"/></>,
    computerScreenshot: <><path d="M2 4.2h2.4l1-1.5h5.2l1 1.5H14v8.5H2z"/><circle cx="8" cy="8.4" r="2.4"/><path d="M11.9 6h.1"/></>,
    computerOcr: <><path d="M2.2 3.4V2.2h3M10.8 2.2h3v3M13.8 10.6v3h-3M5.2 13.6h-3v-3"/><path d="M4.3 10 8 5l3.7 5M5.7 8.2h4.6"/></>,
    computerAction: <><path d="m3 2.2 8.6 7.1-4 .5-1.7 3.7z"/><path d="m9 10 2.7 3"/></>,
    createPlan: <><path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5z"/><path d="m5.2 8 1.8 1.8L11 5.8"/></>,
    updatePlan: <><path d="M12.7 5.5A5.4 5.4 0 0 0 3 4.1L2 5.3M2 2.7v2.7h2.7M3.3 10.5a5.4 5.4 0 0 0 9.7 1.4l1-1.2M14 13.3v-2.7h-2.7"/><path d="M8 5.2v3l2 1"/></>,
    todo: <><path d="M3 3h10v10H3z"/><path d="m5 6 1 1 1.5-1.6M8.7 6.5h2M5 10l1 1 1.5-1.6M8.7 10.5h2"/></>,
    getTaskStatus: <><path d="M2.5 12.8V8.5h2.4v4.3M6.8 12.8V5.8h2.4v7M11.1 12.8V3h2.4v9.8"/></>,
    getExecutionLog: <><path d="M3 2.5h10v11H3z"/><path d="M5.2 5.2h5.6M5.2 7.7h5.6M5.2 10.2h3.2"/><circle cx="11.1" cy="10.3" r="1.7" fill="var(--chat-bg, #161616)"/></>,
    createSkill: <><path d="M8 1.8 9.5 6.5l4.7 1.5-4.7 1.5L8 14.2l-1.5-4.7L1.8 8l4.7-1.5z"/><path d="m12.1 2.1.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"/></>,
    createExtension: <><path d="M3 2.5h6v3h2a1.5 1.5 0 1 1 0 3h-2v3H3z"/><path d="M6 5.5v3M4.5 7h3"/></>,
    deleteExtension: <><path d="M3 3h10M5 3V2h6v1M4.2 4.5l.6 8h5.4l.6-8"/><path d="m6 6.5 3 3m0-3-3 3"/></>,
    createMcpServer: <><path d="M8 2v3M3 5l2 1.2M13 5l-2 1.2M3 11l2-1.2M13 11l-2-1.2M8 12v2"/><circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="2" r=".9"/><circle cx="2.4" cy="4.7" r=".9"/><circle cx="13.6" cy="4.7" r=".9"/><circle cx="2.4" cy="11.3" r=".9"/><circle cx="13.6" cy="11.3" r=".9"/></>,
    deleteMcpServer: <><path d="M8 2v3M3 5l2 1.2M13 5l-2 1.2M3 11l2-1.2M13 11l-2-1.2"/><circle cx="8" cy="8" r="2.4"/><path d="m6.5 6.5 3 3m0-3-3 3"/></>,
    subagent: <><circle cx="8" cy="4" r="2"/><circle cx="3.2" cy="11.5" r="1.6"/><circle cx="12.8" cy="11.5" r="1.6"/><path d="M6.8 5.7 4 10M9.2 5.7l2.8 4M4.8 11.5h6.4"/></>,
    swarm: <><circle cx="8" cy="8" r="1.7"/><circle cx="3" cy="3" r="1.2"/><circle cx="13" cy="3" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="13" cy="13" r="1.2"/><path d="m4 4 2.8 2.8M12 4 9.2 6.8M4 12l2.8-2.8M12 12 9.2 9.2"/></>,
    askUser: <><path d="M2 3h12v8H8l-3.5 2.5V11H2z"/><path d="M6.1 6.1a1.9 1.9 0 1 1 3.3 1.3c-.8.8-1.4.8-1.4 1.8M8 10.4v.1"/></>,
    switchProject: <><path d="M2.5 4.2h4l1.3 1.5h5.7v6.1H2.5z"/><path d="M5 8.5h6M9.2 6.8l1.8 1.7-1.8 1.7"/></>,
    externalBrowserList: <><path d="M2 4h8v7H2zM6 2h8v7"/><path d="M4 6h4M4 8h2"/></>,
    externalBrowserState: <><path d="M2 3h12v9H2z"/><path d="M5 13.5h6M8 12v1.5M4 6.2h8M4 8.5h5"/></>,
    externalBrowserAction: <><path d="M3 2.5v8h8"/><path d="m4 9.5 3-3 2 1.7 3.5-4"/><path d="M10.5 4.2h2.2v2.2"/></>,
    searchSkills: <><path d="m8 2 1.4 4.3L13.8 8l-4.4 1.7L8 14l-1.4-4.3L2.2 8l4.4-1.7z"/><circle cx="12.8" cy="3" r=".7"/></>,
    loadSkill: <><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3M8 6.8v4M6.2 9l1.8 1.8L9.8 9"/></>,
    searchPlugins: <><path d="M2.5 5h11v8h-11z"/><path d="M4 5V3h8v2M5 8h2v2H5zM9 8h2v2H9z"/></>,
    searchChatContext: <><path d="M2 3h12v8H8l-3.5 2.5V11H2z"/><path d="M5 5.8h6M5 8.2h4"/></>,
  };
  const initials = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
  const custom = designs[name] || <><path d="M2.2 8a5.8 5.8 0 1 1 11.6 0A5.8 5.8 0 0 1 2.2 8Z"/><text x="8" y="10.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6.5" fontWeight="700">{initials}</text></>;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{custom}</svg>;
}

export function ProcessingStatusStateFixed({ startedAt, language }: { startedAt: number; language: AppLanguage }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const status = translate('chatActivity.thinking', language);
  const elapsedLabel = formatProcessingDuration(elapsed);
  const processingLabel = translate('chatActivity.valueForValue', language, { status: status, elapsedLabel: elapsedLabel });
  return <span className="chat-turn-processing" style={{ color: '#777', fontSize: '11px' }}>{processingLabel}</span>;
}

export function LiveTurnProgress({ message, language }: { message: any; language: AppLanguage }) {
  const phases: Array<{ id: string; summary: string; tools: any[] }> = [];
  const tools = new Map<string, any>((message.tools || []).map((event: any) => [event.id || event.callId, event]));
  for (const event of message.timeline || []) {
    if (event.type === 'progress') phases.push({ id: event.id, summary: event.text, tools: [] });
    if (event.type === 'tool') {
      if (!phases.length) phases.push({ id: 'initial', summary: getMessages('activity', language).thinking, tools: [] });
      phases.at(-1)!.tools.push(tools.get(event.id) || event);
    }
  }
  if (!phases.length) phases.push({ id: 'current', summary: message.progress || getMessages('activity', language).thinking, tools: message.tools || [] });
  return <div className="chat-live-progress" aria-label={getMessages('activity', language).thinking}>
    {phases.map((phase, index) => <div key={phase.id} className="chat-progress-phase" data-active={index === phases.length - 1}>
      {phase.tools.length ? <TurnActivity progress={phase.summary} tools={phase.tools} active={index === phases.length - 1} language={language} /> : <p className="chat-progress-label"><span>{phase.summary}</span></p>}
    </div>)}
  </div>;
}

export function TurnActivity({ progress = '', timeline = [], tools = [], changes, active, language }: { progress?: string; timeline?: any[]; tools?: any[]; changes?: { additions: number; deletions: number; files: number; fileChanges?: Array<{ path: string; additions: number; deletions: number; status: string }> } | null; active: boolean; language: AppLanguage }) {
  const events = tools.length ? tools : timeline.filter((event) => event.type === 'tool');
  const fileChanges = changes?.fileChanges || [];
  if (!events.length && !fileChanges.length && !(active && progress)) return null;
  const summary = progress.trim() || (active
    ? (translate('chatActivity.working', language))
    : (translate('chatActivity.activityValueSteps', language, { value1: events.length + fileChanges.length })));
  const changedPathsByWrite = new Set(events.filter((event) => event.name === 'writeFile').map((event) => event.input?.path));
  const consoleText = getMessages('toolConsole', language);
  return <details className="turn-activity">
    <summary className="turn-activity-summary">
      <span>{summary}</span>
      <ChevronDown size={14} className="turn-activity-chevron" aria-hidden="true" />
    </summary>
    <div className="turn-activity-list">
      {events.map((event, index) => {
        const name = event.name === 'executeTool' ? event.input?.name || event.name : event.name;
        const input = activityToolInput(event);
        const output = activityToolOutput(event.output);
        const isRunning = event.output?.status === 'running' || event.status === 'running';
        const isFailed = event.output?.ok === false || output?.ok === false || output?.error || output?.code > 0 || event.status === 'error';
        const label = name.startsWith('externalBrowser') ? `${name} · ${isRunning ? consoleText.running : isFailed ? consoleText.failed : consoleText.done}` : name === 'runCommand' ? (translate('chatActivity.commandExecuted', language)) : name === 'writeFile' ? (translate('chatActivity.edited', language)) : toolActivityLabel(name, input, language, !isRunning && !isFailed);
        const pathChange = name === 'writeFile' ? fileChanges.find((item) => item.path === input.path) : null;
        const pathLabel = String(input.path || input.filePath || input.command || input.url || input.title || input.specialist || '');
        const command = [input.command, ...(Array.isArray(input.args) ? input.args : [])].filter(Boolean).join(' ');
        const stdout = output?.stdout ?? '';
        const stderr = output?.stderr ?? output?.error ?? '';
        const exitCode = output?.code;
        const isCommand = name === 'runCommand';
        const changedCount = pathChange ? <span className="turn-activity-delta"><span>+{pathChange.additions}</span><span>−{pathChange.deletions}</span></span> : null;
        return <details className="turn-activity-item" key={event.id || event.callId || `${name}-${index}`}>
          <summary>
            <ToolActivityIcon name={name} className="turn-activity-action-icon" size={14} strokeWidth={1.7} aria-hidden="true" />
            <span className="sr-only">{isRunning ? (translate('chatActivity.running', language)) : isFailed ? (translate('chatActivity.failed', language)) : (translate('chatActivity.done', language))}</span>
            <span className={`turn-activity-item-label ${isFailed ? 'turn-activity-item-error' : ''}`}>{label}</span>
            <span className="turn-activity-item-detail" title={isCommand ? command : pathLabel}>{isCommand ? command : pathLabel}</span>
            {changedCount}
            <ChevronDown size={13} className="turn-activity-chevron" aria-hidden="true" />
          </summary>
          <div className="turn-activity-detail">
            {isCommand && <div className="turn-command-card">
              <div className="turn-command-heading"><Terminal size={13} /><span>Shell</span>{typeof exitCode === 'number' && <span className={exitCode === 0 ? 'turn-command-ok' : 'turn-command-error'}>{exitCode === 0 ? (translate('chatActivity.done', language)) : `Exit ${exitCode}`}</span>}</div>
              <pre className="turn-command-code"><span aria-hidden="true">$ </span>{command}</pre>
              {(stdout || stderr) ? <pre className={stderr ? 'turn-command-output turn-command-stderr' : 'turn-command-output'}>{[stdout, stderr].filter(Boolean).join('\n')}</pre> : <div className="turn-command-empty">{translate('chatActivity.noOutput', language)}</div>}
            </div>}
            {!isCommand && pathChange && <div className="turn-activity-file-delta"><FileCode2 size={13} /><span>{input.path}</span><span className="turn-activity-delta"><span>+{pathChange.additions}</span><span>−{pathChange.deletions}</span></span></div>}
            {!isCommand && !pathChange && pathLabel && <div className="turn-activity-raw-detail">{pathLabel}</div>}
            {!isCommand && <div className="turn-command-card turn-tool-console" role="region" aria-label={`${consoleText.title} · ${name}`}>
              <div className="turn-command-heading"><Terminal size={13} /><span>{name}</span><span className={isFailed ? 'turn-command-error' : ''}>{isRunning ? consoleText.running : isFailed ? consoleText.failed : consoleText.done}</span></div>
              <div className="turn-tool-console-label">{consoleText.input}</div>
              <pre className="turn-command-output">{activityConsoleText(input, consoleText.truncated)}</pre>
              <div className="turn-tool-console-label">{consoleText.output}</div>
              <pre className={`turn-command-output ${isFailed ? 'turn-command-stderr' : ''}`}>{isRunning ? consoleText.waiting : activityConsoleText(output, consoleText.truncated) || consoleText.empty}</pre>
            </div>}
            {typeof event.durationMs === 'number' && <div className="turn-activity-duration">{(event.durationMs / 1000).toFixed(1)}s</div>}
          </div>
        </details>;
      })}
      {fileChanges.filter((change) => !changedPathsByWrite.has(change.path)).map((change) => <div className="turn-activity-item turn-activity-file-row" key={`change-${change.path}`}>
        <ToolActivityIcon name="writeFile" className="turn-activity-action-icon" size={14} />
        <FileCode2 size={13} aria-hidden="true" />
        <span className="turn-activity-item-label">{translate('chatActivity.edited', language)}</span>
        <span className="turn-activity-item-detail" title={change.path}>{change.path}</span>
        <span className="turn-activity-delta"><span>+{change.additions}</span><span>−{change.deletions}</span></span>
      </div>)}
    </div>
  </details>;
}

export function AskUserCards({ tools = [], onSelect, onRespondInChat }: { tools?: any[]; onSelect: (answer: string, questionId: string) => void; onRespondInChat: () => void; disabled?: boolean }) {
  const language = useAppLanguage();
  const questions = tools.filter((event) => event.name === 'askUser' && event.output?.status === 'awaiting_user' && !event.answer);
  if (!questions.length) return null;
  return <div style={{ display: 'grid', gap: '8px', width: 'min(520px, 100%)', margin: '2px 0 2px' }}>
    {questions.map((event) => <div key={event.id} style={{ display: 'grid', gap: '8px', padding: '4px 0', border: 0, borderRadius: 0, background: 'transparent' }}>
      <div style={{ color: '#d8d8d8', fontSize: '12px', lineHeight: 1.4 }}>{event.output.question}</div>
      {event.output.context && <div style={{ color: '#777', fontSize: '10px' }}>{event.output.context}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '7px' }}>
        {event.output.options?.length
          ? event.output.options.map((option: string) => <button key={option} type="button" onClick={() => onSelect(option, event.id)} onMouseEnter={(event) => { event.currentTarget.style.background = '#202020'; event.currentTarget.style.borderColor = '#4a4a4a'; }} onMouseLeave={(event) => { event.currentTarget.style.background = '#151515'; event.currentTarget.style.borderColor = '#252525'; }} style={{ display: 'flex', alignItems: 'center', minHeight: '36px', padding: '5px 9px', border: '1px solid #252525', borderRadius: '8px', background: '#151515', color: '#ddd', cursor: 'pointer', textAlign: 'left', fontSize: '11px', transition: 'background 120ms ease, border-color 120ms ease' }}>{option}</button>)
          : <button type="button" onClick={onRespondInChat} onMouseEnter={(event) => { event.currentTarget.style.background = '#202020'; event.currentTarget.style.borderColor = '#4a4a4a'; }} onMouseLeave={(event) => { event.currentTarget.style.background = '#151515'; event.currentTarget.style.borderColor = '#252525'; }} style={{ display: 'flex', alignItems: 'center', minHeight: '36px', padding: '5px 9px', border: '1px solid #252525', borderRadius: '8px', background: '#151515', color: '#ddd', cursor: 'pointer', textAlign: 'left', fontSize: '11px', transition: 'background 120ms ease, border-color 120ms ease' }}>{translate('chatActivity.replyInChat', language)}</button>}
      </div>
    </div>)}
  </div>;
}

export function ApprovalCards({ approvals = [], onResolve }: { approvals?: any[]; onResolve: (id: string, approved: boolean) => void }) {
  const language=useAppLanguage(),text=getMessages('activity', language);
  if (!approvals.length) return null;
  return <div style={{ display: 'grid', gap: '7px', width: 'min(520px, 100%)', margin: '4px 0 2px' }}>
    {approvals.map((approval) => <div key={approval.id} style={{ display: 'grid', gap: '6px', minWidth: 0, padding: '8px 10px', border: '1px solid #2b2b2b', borderRadius: '9px', background: '#151515', color: '#eee', fontSize: '11px' }}>
      <div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#d8d8d8', fontWeight: 600 }}>{approval.toolName}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777' }}>{approval.summary}</span>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button type="button" onClick={() => onResolve(approval.id, true)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: '#1687ff22', color: '#8bc7ff', cursor: 'pointer', fontSize: '11px' }}>{text.allow}</button>
        <button type="button" onClick={() => onResolve(approval.id, false)} style={{ minHeight: '26px', border: 0, borderRadius: '7px', padding: '0 10px', background: 'transparent', color: '#999', cursor: 'pointer', fontSize: '11px' }}>{text.deny}</button>
      </div>
    </div>)}
  </div>;
}
