import type { ScheduledTask, TaskRun } from '../../electron/task-scheduler';
import { models, providers } from './ai-catalog';
import { credentialKeyFor, modelMatchesProvider, usesGateway } from './ai-routing';
import { getProjectSetting, getSetting, setProjectSetting, setSetting } from './persistence';
export type { ScheduledTask, TaskRun };
export const taskProvider = (value: string) => providers.find(provider => provider.id === value || provider.label === value);
export const taskModel = (value: string, provider: any) => models.find(model => (model.id === value || model.gatewayId === value || model.label === value) && provider && (provider.id === 'custom' || modelMatchesProvider(model, provider)));
let migration: Promise<void> | undefined;
/** Import all scopes once, moving legacy credentials to the native vault before clearing old arrays. */
export function migrateScheduledTasks() {
  return migration ||= (async () => {
    const api = (window as any).codeclub;
    if (!api?.tasksList) return;
    const projects = await api.listProjects();
    for (const projectPath of ['', ...projects.map((project: any) => project.path)]) {
      let legacy = await getProjectSetting<any[]>(projectPath, 'scheduled-tasks', []);
      if (!projectPath && !legacy.length) legacy = await getSetting<any[]>('codeclub:scheduled-tasks', []);
      if (!Array.isArray(legacy) || !legacy.length) continue;
      const existing: ScheduledTask[] = await api.tasksList(projectPath);
      for (const task of legacy) {
        const provider = taskProvider(task.provider);
        const model = taskModel(task.model, provider);
        if (task.apiKey && task.apiKey !== 'codeclub-native-credential') {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${projectPath}:${task.id}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const key = provider ? credentialKeyFor(provider, model) : `scheduled_legacy_${hash}_api_key`;
          await setSetting(key, task.apiKey);
        }
        if (!provider || !model || !task.name?.trim() || !task.prompt?.trim()) continue;
        if (!existing.some(item => item.id === task.id)) await api.tasksSave(projectPath, { ...task, apiKey: undefined, provider: provider.id, model: usesGateway(provider, model) ? model.gatewayId : model.id, interval: task.interval || (task.repeat === 'Todos los días' ? 'Diario' : 'Días hábiles'), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      }
      // Keep incomplete drafts available for manual repair, without plaintext credentials.
      await setProjectSetting(projectPath, 'scheduled-tasks', legacy.filter(task => !taskProvider(task.provider) || !taskModel(task.model, taskProvider(task.provider)) || !task.prompt?.trim() || !task.name?.trim()).map(({ apiKey: _secret, ...task }) => task));
      if (!projectPath) await setSetting('codeclub:scheduled-tasks', []);
    }
  })().catch(error => { migration = undefined; throw error; });
}
