import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ScheduledTask } from './task-scheduler.js';

export type LearningOrb = { id: string; name: string; purpose: string; chatId?: string; providerId: string; modelId: string; maximumAutonomy?: boolean; allowComputer?: boolean; requiresAdministrator?: boolean };
/** Paused one-shot jobs still need a valid date before the scheduler can save them. */
export const proactiveOrbTask = (orb: LearningOrb, context: string, language: 'es' | 'en', now = Date.now()): Partial<ScheduledTask> => ({
  id: `orb_proactive_${orb.id}`, orbId: orb.id, name: orb.name, prompt: context, provider: orb.providerId, model: orb.modelId,
  proactive: true, deliveryChatId: orb.chatId || `orb-chat-${orb.id}`, autonomous: true, maximumAutonomy: true,
  allowComputer: false, status: 'paused', interval: 'Una vez', runAt: new Date(now).toISOString(), notifications: 'Sin notificaciones', language,
});
type UpcomingTask = { key: string; name: string; projectPath: string; scheduledAt: string; execution: string };
type Profile = { weights: number[]; samples: number; contexts: Record<string, number>; transitions: Record<string, number>; lastContext: string; lastApplication?: string; revision: number; attemptedRevision: number; lastAttempt: number; lastDelivered: number; hashes: string[]; taskNotices?: string[]; pending?: { features: number[]; at: number } };
const initial = (): Profile => ({ weights: [0, 0, 0, 0, 0], samples: 0, contexts: {}, transitions: {}, lastContext: '', revision: 0, attemptedRevision: -1, lastAttempt: 0, lastDelivered: 0, hashes: [] });
const sigmoid = (value: number) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));
const probability = (weights: number[], features: number[]) => sigmoid(weights.reduce((sum, weight, index) => sum + weight * features[index], 0));
const digest = (text: string) => createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

/** Online engagement learning over bounded metadata, not screen contents or input text. */
export class OrbLearning {
  private profiles: Record<string, Profile> = Object.create(null);
  private inFlight = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private observedAt = 0;
  private ready = new Set<string>();
  private lastContext = 'home';
  constructor(private file: string, private environment: { active: () => boolean; orbs: () => LearningOrb[]; busy: (chatId: string) => boolean; upcoming?: () => UpcomingTask[]; suggest: (orb: LearningOrb, context: string) => Promise<void> }, private now = Date.now) {
    try {
      const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
      for (const [id, value] of Object.entries(saved)) {
        const profile = value as Profile;
        if (/^[\w-]{1,100}$/.test(id) && profile.weights?.length === 5 && profile.weights.every(Number.isFinite)) this.profiles[id] = { ...initial(), ...profile };
      }
    } catch { /* Corrupt learning data starts clean without affecting chats or credentials. */ }
  }
  private enabled() { return this.environment.orbs().filter(orb => orb.maximumAutonomy === true); }
  private persist() {
    const orbs = this.environment.orbs();
    const existing = new Set(orbs.map(orb => orb.id));
    for (const id of Object.keys(this.profiles)) if (!existing.has(id)) delete this.profiles[id];
    for (const orb of orbs.filter(orb => orb.maximumAutonomy !== true)) if (this.profiles[orb.id]) delete this.profiles[orb.id].pending;
    for (const orb of orbs.filter(orb => !orb.allowComputer)) {
      const profile = this.profiles[orb.id];
      if (profile) { for (const context of Object.keys(profile.contexts)) if (context.startsWith('app:')) delete profile.contexts[context]; delete profile.lastApplication; }
    }
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.profiles), 'utf8'); renameSync(`${this.file}.tmp`, this.file);
  }
  private profile(id: string) { return this.profiles[id] ||= initial(); }
  private features(profile: Profile) {
    const counts = Object.values(profile.contexts);
    const total = counts.reduce((sum, value) => sum + value, 0);
    const hour = new Date(this.now()).getHours() * Math.PI / 12;
    return [1, total ? Math.min(1, (profile.contexts[profile.lastContext] || 0) / total) : 0, Math.min(1, profile.revision / 20), Math.sin(hour), Math.cos(hour)];
  }
  private train(profile: Profile, target: number) {
    if (!profile.pending) return;
    const error = target - probability(profile.weights, profile.pending.features);
    profile.weights = profile.weights.map((weight, index) => weight + 0.1 * (error * profile.pending!.features[index] - 0.01 * weight));
    profile.samples += 1; delete profile.pending;
  }
  observe(context: string, ready: string[]) {
    if (!this.environment.active() || !/^(home|chat|orb|tasks|extensions|files|browser|terminals|review)$/.test(context)) return;
    if (!this.observedAt || this.now() - this.observedAt > 90000) for (const profile of Object.values(this.profiles)) delete profile.pending;
    this.observedAt = this.now(); this.lastContext = context; this.ready = new Set(ready.filter(id => /^[\w-]{1,100}$/.test(id)));
    for (const orb of this.enabled()) {
      const profile = this.profile(orb.id);
      if (profile.lastContext !== context) {
        const transition = `${profile.lastContext || 'start'}>${context}`;
        profile.transitions[transition] = (profile.transitions[transition] || 0) + 1;
        profile.revision += 1;
      }
      profile.contexts[context] = (profile.contexts[context] || 0) + 1;
      profile.lastContext = context;
    }
    this.persist();
  }
  /** PC metadata must be collected separately and only when the PC switch is enabled. */
  observeApplication(application: string, authorizedIds?: string[]) {
    if (!this.environment.active() || this.now() - this.observedAt > 90000 || !/^[\w.-]{1,80}$/.test(application) || /password|credential|keypass|keepass|1password|bitwarden|lastpass/i.test(application)) return;
    for (const orb of this.enabled().filter(orb => orb.allowComputer === true && (!authorizedIds || authorizedIds.includes(orb.id)))) {
      const profile = this.profile(orb.id);
      const context = `app:${application.toLowerCase()}`;
      // Bound storage even when many different desktop processes are encountered.
      if (!(context in profile.contexts) && Object.keys(profile.contexts).length >= 64) continue;
      profile.contexts[context] = (profile.contexts[context] || 0) + 1;
      if (profile.lastApplication !== context) { profile.revision += 1; profile.lastApplication = context; }
    }
    this.persist();
  }
  respond(chatId: string) {
    if (!this.environment.active() || this.now() - this.observedAt > 90000) return;
    for (const orb of this.enabled()) if ((orb.chatId || `orb-chat-${orb.id}`) === chatId) {
      const profile = this.profile(orb.id);
      profile.revision += 1;
      if (profile.pending && this.now() - profile.pending.at <= 10 * 60000) this.train(profile, 1);
      this.persist();
    }
  }
  observeOutcome(kind: string) {
    if (!this.environment.active() || this.now() - this.observedAt > 90000 || !['edit', 'command', 'browser', 'task-completed', 'task-failed'].includes(kind)) return;
    for (const orb of this.enabled()) {
      const profile = this.profile(orb.id);
      const context = `action:${kind}`;
      profile.contexts[context] = (profile.contexts[context] || 0) + 1; profile.revision += 1;
    }
    this.persist();
  }
  result(orbId: string, message: string) {
    if (!this.environment.active() || !this.enabled().some(orb => orb.id === orbId)) return false;
    const profile = this.profile(orbId);
    if (!message.trim() || message.trim() === 'NO_SUGGESTION') return false;
    const hash = digest(message);
    if (profile.hashes.includes(hash)) return false;
    profile.hashes = [...profile.hashes.slice(-19), hash]; profile.lastDelivered = this.now();
    profile.pending = { features: this.features(profile), at: this.now() }; this.persist();
    return true;
  }
  async tick() {
    if (this.ticking || !this.environment.active() || this.now() - this.observedAt > 90000) return;
    this.ticking = true;
    try {
      for (const orb of this.enabled()) {
        const chatId = orb.chatId || `orb-chat-${orb.id}`;
        const profile = this.profile(orb.id);
        // Silence is weak negative feedback only after an active observation window.
        if (profile.pending && this.now() - profile.pending.at > 10 * 60000) this.train(profile, 0);
        if (!this.ready.has(orb.id) || this.inFlight.has(orb.id) || this.environment.busy(chatId)) continue;
        const upcomingTasks = (this.environment.upcoming?.() || []).filter(task => !(profile.taskNotices || []).includes(digest(task.key)));
        // A newly approaching schedule is time-sensitive, unlike generic engagement suggestions.
        if (!upcomingTasks.length) {
          if (profile.lastAttempt && this.now() - profile.lastAttempt < 30 * 60000) continue;
          if (profile.lastDelivered && this.now() - profile.lastDelivered < 60 * 60000) continue;
          if (profile.attemptedRevision === profile.revision) continue;
          if (profile.samples >= 5 && probability(profile.weights, this.features(profile)) < 0.35) continue;
        }
        // Persist occurrence keys before dispatch so restarts and silence cannot repeat notices.
        if (upcomingTasks.length) profile.taskNotices = [...(profile.taskNotices || []), ...upcomingTasks.map(task => digest(task.key))].slice(-100);
        profile.lastAttempt = this.now(); profile.attemptedRevision = profile.revision; this.inFlight.add(orb.id); this.persist();
        const context = JSON.stringify({ upcomingTasks: upcomingTasks.map(({ key, ...task }) => task), currentSurface: this.lastContext, frequentContexts: Object.entries(profile.contexts).sort((a, b) => b[1] - a[1]).slice(0, 6), recurringTransitions: Object.entries(profile.transitions).sort((a, b) => b[1] - a[1]).slice(0, 4), feedbackSamples: profile.samples, estimatedEngagement: probability(profile.weights, this.features(profile)) });
        try { await this.environment.suggest(orb, context); } finally { this.inFlight.delete(orb.id); }
      }
      this.persist();
    } finally { this.ticking = false; }
  }
  start() { if (!this.timer) this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 30000); }
  stop() { clearInterval(this.timer); this.timer = undefined; }
  refresh() { this.persist(); }
  status(id: string) { const profile = this.profiles[id]; return { samples: profile?.samples || 0, observations: Object.values(profile?.contexts || {}).reduce((sum, value) => sum + value, 0), lastDelivered: profile?.lastDelivered || null }; }
}
