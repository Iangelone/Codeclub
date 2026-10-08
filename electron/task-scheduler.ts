import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type TaskRun = { id: string; chatId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: string; finishedAt?: string; error?: string };
export type ScheduledTask = {
  id: string; name: string; prompt: string; projectPath: string; provider: string; model: string;
  interval: string; every: string; time: string; timeZone: string; weekday: number;
  status: 'active' | 'paused'; notifications: string; reasoning: string;
  language?: 'es' | 'en';
  autonomous?: boolean;
  nextRun?: string; lastRun?: string; runs: TaskRun[];
  runAt?: string;
};
const keyFor = (project: string, id: string) => `${project ? path.resolve(project).toLowerCase() : ''}\0${id}`;
const cadence: Record<string, number> = { '15 min': 15, '30 min': 30, '1 hora': 60, '1 hour': 60, '2 horas': 120, '2 hours': 120, '1 día': 1440, '1 day': 1440 };
const formatters = new Map<string, Intl.DateTimeFormat>();
function calendar(time: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); formatters.set(zone, formatter); }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(item => [item.type, Number(item.value)]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute, weekday: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() };
}
/** Calendar schedules follow the task's IANA zone, including DST. Custom intervals use elapsed time. */
export function nextTaskRun(task: Pick<ScheduledTask, 'interval' | 'every' | 'time' | 'timeZone' | 'weekday' | 'runAt'>, after: number): string {
  if (task.interval === 'Una vez') {
    if (!task.runAt || !Number.isFinite(Date.parse(task.runAt))) throw new Error('TASK_INVALID_SCHEDULE');
    return new Date(task.runAt).toISOString();
  }
  if (task.interval === 'Personalizado') {
    const minutes = cadence[task.every];
    if (!minutes) throw new Error('TASK_INVALID_INTERVAL');
    return new Date(after + minutes * 60000).toISOString();
  }
  if (!['Diario', 'Días hábiles', 'Semanal'].includes(task.interval) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) throw new Error('TASK_INVALID_SCHEDULE');
  const [hour, minute] = task.time.split(':').map(Number);
  const previous = calendar(after, task.timeZone);
  for (let candidate = Math.floor(after / 60000) * 60000 + 60000; candidate <= after + 9 * 86400000; candidate += 60000) {
    const local = calendar(candidate, task.timeZone);
    // Daily/weekly jobs fire once per local date when clocks move backwards.
    if (local.date === previous.date && previous.hour * 60 + previous.minute >= hour * 60 + minute) continue;
    if (local.hour === hour && local.minute === minute && (task.interval === 'Diario' || (task.interval === 'Días hábiles' ? local.weekday >= 1 && local.weekday <= 5 : local.weekday === task.weekday))) return new Date(candidate).toISOString();
  }
  throw new Error('TASK_INVALID_SCHEDULE');
}

export class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  private stopped = false;
  constructor(private file: string, private execute: (task: ScheduledTask, run: TaskRun) => Promise<void>, private changed: () => void, private finished: (task: ScheduledTask, run: TaskRun) => void = () => {}, private now = () => Date.now()) {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(saved)) throw new Error('TASK_STORAGE_INVALID');
      this.tasks = saved;
      for (const task of this.tasks) for (const run of task.runs) if (run.status === 'running') { run.status = 'interrupted'; run.finishedAt = new Date(this.now()).toISOString(); }
      this.persist();
    }
  }
  private persist() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.tasks, null, 2), 'utf8');
    renameSync(`${this.file}.tmp`, this.file);
    this.changed();
  }
  list(projectPath: string) { return structuredClone(this.tasks.filter(task => keyFor(task.projectPath, '') === keyFor(projectPath, ''))); }
  save(projectPath: string, input: Partial<ScheduledTask>) {
    if (projectPath && !path.isAbsolute(projectPath)) throw new Error('TASK_INVALID_PROJECT');
    if (!input.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) || !input.name?.trim() || !input.prompt?.trim() || !input.provider || !input.model) throw new Error('TASK_INVALID_CONFIG');
    if (input.prompt.length > 100000 || input.name.length > 200) throw new Error('TASK_INVALID_CONFIG');
    const old = this.tasks.find(task => keyFor(task.projectPath, task.id) === keyFor(projectPath, input.id!));
    const task: ScheduledTask = {
      id: input.id, name: input.name.trim(), prompt: input.prompt.trim(), projectPath: projectPath ? path.resolve(projectPath) : '', provider: input.provider, model: input.model,
      interval: input.interval || 'Días hábiles', every: input.every || '30 min', time: input.time || '08:00', timeZone: input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, weekday: Number(input.weekday ?? 1),
      status: input.status === 'paused' ? 'paused' : 'active', notifications: ['Todas las ejecuciones', 'Solo errores', 'Sin notificaciones'].includes(input.notifications || '') ? input.notifications! : 'Todas las ejecuciones', reasoning: input.reasoning || 'Medio',
      language: input.language === 'en' ? 'en' : 'es',
      autonomous: input.autonomous === true && input.id.startsWith('orb_'),
      runAt: input.runAt,
      runs: old?.runs || [], lastRun: old?.lastRun,
    };
    if (!Number.isInteger(task.weekday) || task.weekday < 0 || task.weekday > 6) throw new Error('TASK_INVALID_SCHEDULE');
    new Intl.DateTimeFormat('en-US', { timeZone: task.timeZone });
    const next = nextTaskRun(task, this.now());
    if (task.interval === 'Una vez' && task.status === 'active' && Date.parse(next) <= this.now()) throw new Error('TASK_INVALID_SCHEDULE');
    const sameSchedule = old && ['interval', 'every', 'time', 'timeZone', 'weekday', 'runAt'].every(field => old[field as keyof ScheduledTask] === task[field as keyof ScheduledTask]);
    task.nextRun = task.status === 'active' ? (sameSchedule && old.status === 'active' ? old.nextRun || next : next) : undefined;
    if (task.status === 'paused') for (const run of task.runs) if (run.status === 'queued') { run.status = 'cancelled'; run.finishedAt = new Date(this.now()).toISOString(); }
    if (old) this.tasks[this.tasks.indexOf(old)] = task; else this.tasks.push(task);
    this.persist();
    return structuredClone(task);
  }
  remove(projectPath: string, id: string) {
    const task = this.get(projectPath, id);
    if (task.runs.some(run => run.status === 'running')) throw new Error('TASK_RUNNING');
    this.tasks = this.tasks.filter(item => item !== task); this.persist();
  }
  private get(projectPath: string, id: string) {
    const task = this.tasks.find(item => keyFor(item.projectPath, item.id) === keyFor(projectPath, id));
    if (!task) throw new Error('TASK_NOT_FOUND'); return task;
  }
  run(projectPath: string, id: string) {
    const task = this.get(projectPath, id);
    if (task.runs.some(run => ['queued', 'running'].includes(run.status))) throw new Error('TASK_RUNNING');
    const run: TaskRun = { id: randomUUID(), chatId: `scheduled-${randomUUID()}`, status: 'queued', startedAt: new Date(this.now()).toISOString() };
    task.runs = [...task.runs.slice(-19), run]; this.persist();
    void this.drain(); return structuredClone(run);
  }
  cancelQueued(projectPath: string, id: string) {
    const task = this.get(projectPath, id);
    const run = task.runs.find(item => item.status === 'queued');
    if (!run) return false;
    run.status = 'cancelled'; run.finishedAt = new Date(this.now()).toISOString(); this.persist(); return true;
  }
  tick() {
    if (this.stopped) return;
    for (const task of this.tasks) {
      if (task.status !== 'active' || !task.nextRun || Date.parse(task.nextRun) > this.now()) continue;
      // Catch up once after sleep/restart; never replay all missed mutations.
      if (task.interval === 'Una vez') { task.nextRun = undefined; task.status = 'paused'; }
      else task.nextRun = nextTaskRun(task, this.now());
      this.persist();
      if (!task.runs.some(run => ['queued', 'running'].includes(run.status))) this.run(task.projectPath, task.id);
    }
    void this.drain();
  }
  start() { this.stopped = false; this.timer = setInterval(() => this.tick(), 15000); this.tick(); }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  private async drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped) {
        const task = this.tasks.find(item => item.runs.some(run => run.status === 'queued'));
        const run = task?.runs.find(item => item.status === 'queued');
        if (!task || !run) break;
        run.status = 'running'; run.startedAt = new Date(this.now()).toISOString(); task.lastRun = run.startedAt; this.persist();
        try { await this.execute(structuredClone(task), structuredClone(run)); run.status = 'completed'; }
        catch (error) { run.status = error instanceof Error && error.message === 'TASK_CANCELLED' ? 'cancelled' : 'failed'; run.error = error instanceof Error && /^TASK_[A-Z_]+$/.test(error.message) ? error.message : 'TASK_EXECUTION_FAILED'; }
        run.finishedAt = new Date(this.now()).toISOString(); this.persist(); this.finished(task, run);
      }
    } finally { this.draining = false; }
  }
}
