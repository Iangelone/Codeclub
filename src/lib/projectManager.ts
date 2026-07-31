import { appConfigDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getAppConfigFilePath, getProjectFilePath, getSetting, logPersistence, migrateLegacyProjectData, setSetting } from "./persistence.ts";
import { invoke } from "@tauri-apps/api/core";

const PROJECTS_INDEX = "projects.json";
const PROJECTS_BACKUP_INDEX = "projects.backup.json";

export interface ProjectEntry {
  path: string;
  name: string;
  file_count?: number;
  directory_count?: number;
  total_size?: number;
  files?: string[];
  indexed_at?: string;
}

export interface ProjectIndexSnapshot {
  fileCount: number;
  directoryCount: number;
  totalSize: number;
  files: string[];
}

export interface ProjectMeta {
  name: string;
  path: string;
  created_at: string;
  chats: Array<{ id: string; name: string }>;
}

export interface BusinessWorkspace {
  version: 2;
  currency: string;
  project: { status: string; estimated_value: number | null; contracted_value: number | null; monthly_fee: number | null; next_billing_date: string | null };
  profile: { description: string; services: string[]; target_clients: string[] };
  pricing: { model: "value_based"; objective: string; expected_impact: string; value_hypothesis: string; success_metrics: Array<{ name: string; baseline: string | number | null; target: string | number | null; unit: string }> ; retainer_monthly: number | null };
  dashboard: { visible_panels: Record<string, boolean>; panel_types: Record<string, "metric" | "progress" | "trend" | "status"> };
  opportunities: any[];
  estimates: any[];
  quotes: any[];
  outcomes: any[];
  milestones: any[];
  payments: any[];
  expenses: any[];
  invoices: any[];
  notes: any[];
  updated_at: string;
}

export interface CodeclubProfile {
  id: string;
  name: string;
  role: string;
  created_at: string;
  last_seen: string;
}

export interface GlobalChatEntry {
  id: string;
  name: string;
  projectPath: "";
  projectName: "Sin proyecto";
}

const GLOBAL_CHATS_SETTING = "codeclub_global_chats";
const GLOBAL_CHAT_HISTORIES_SETTING = "codeclub_global_chat_histories";
export const readGlobalChats = async (): Promise<GlobalChatEntry[]> => {
  const chats = await getSetting<GlobalChatEntry[]>(GLOBAL_CHATS_SETTING, []);
  return Array.isArray(chats) ? chats : [];
};
export const writeGlobalChats = async (chats: GlobalChatEntry[]) => setSetting(GLOBAL_CHATS_SETTING, chats);
export const readGlobalChatHistory = async (chatId: string): Promise<any[]> => {
  const histories = await getSetting<Record<string, any[]>>(GLOBAL_CHAT_HISTORIES_SETTING, {});
  return Array.isArray(histories[chatId]) ? histories[chatId] : [];
};
export const writeGlobalChatHistory = async (chatId: string, messages: any[]) => {
  const histories = await getSetting<Record<string, any[]>>(GLOBAL_CHAT_HISTORIES_SETTING, {});
  histories[chatId] = messages;
  await setSetting(GLOBAL_CHAT_HISTORIES_SETTING, histories);
};

export const getProjectMetaPath = (projectPath: string) => getProjectFilePath(projectPath, "meta.json");
export const getBusinessWorkspacePath = (projectPath: string) => getProjectFilePath(projectPath, "business.json");
export const getProjectChatPath = (projectPath: string, chatId: string) => getProjectFilePath(projectPath, "chats", `${chatId}.jsonl`);

export const readProjectMeta = async (projectPath: string): Promise<ProjectMeta | null> => {
  const path = await getProjectMetaPath(projectPath);
  if (!(await exists(path))) return null;
  try {
    const data = JSON.parse(await readTextFile(path));
    return { ...data, chats: Array.isArray(data.chats) ? data.chats : [] };
  } catch {
    return null;
  }
};

export const writeProjectMeta = async (projectPath: string, meta: ProjectMeta) => {
  const path = await getProjectMetaPath(projectPath);
  await mkdir(await getProjectFilePath(projectPath), { recursive: true });
  await writeTextFile(path, JSON.stringify(meta));
};

export const ensureProjectMeta = async (projectPath: string, name: string) => {
  const current = await readProjectMeta(projectPath);
  const meta: ProjectMeta = {
    name,
    path: projectPath,
    created_at: current?.created_at || new Date().toISOString(),
    chats: current?.chats || [],
  };
  await writeProjectMeta(projectPath, meta);
  await logPersistence("save_project_meta", "ok", { name, projectPath, path: await getProjectMetaPath(projectPath) });
};

export const saveProjectIndex = async (name: string, projectPath: string) => {
  const globalProjects = await readProjectIndex();
  const existingProject = globalProjects.find((project) => project.path === projectPath);
  if (existingProject) existingProject.name = name;
  else globalProjects.push({ name, path: projectPath });
  await writeProjectIndex(globalProjects);
  await logPersistence("save_project_index", "ok", { name, projectPath, count: globalProjects.length });
};

export const ensureCodeclubFolder = async (projectPath: string) => {
  await migrateLegacyProjectData(projectPath);
  await mkdir(await join(projectPath, ".codeclub"), { recursive: true });
};

export const readBusinessWorkspace = async (projectPath: string): Promise<BusinessWorkspace | null> => {
  const path = await getBusinessWorkspacePath(projectPath);
  if (!(await exists(path))) return null;
  try {
    let data = JSON.parse(await readTextFile(path));
    const needsMigration = Number(data.version || 1) < 2 || "hourly_rate" in (data.pricing || {}) || "time_entries" in data;
    if (needsMigration) {
      const backupPath = await getProjectFilePath(projectPath, "business.backup-v1.json");
      if (!(await exists(backupPath))) await writeTextFile(backupPath, JSON.stringify(data, null, 2));
      const migratedQuotes = (Array.isArray(data.quotes) ? data.quotes : []).map((quote: any) => ({
        ...quote,
        items: (Array.isArray(quote.items) ? quote.items : []).map((item: any) => {
          const amount = Number(item.amount ?? item.total ?? (Number(item.unitPrice || 0) * Number(item.quantity || 1)));
          return { description: item.description || "Resultado entregable", type: item.type || "deliverable", outcome: item.outcome || item.description || "", metric: item.metric || "", amount, total: amount };
        }),
      }));
      const migrated = {
        ...data,
        version: 2,
        pricing: {
          model: "value_based",
          objective: data.pricing?.objective || "",
          expected_impact: data.pricing?.expected_impact || "",
          value_hypothesis: data.pricing?.value_hypothesis || "",
          success_metrics: Array.isArray(data.pricing?.success_metrics) ? data.pricing.success_metrics : [],
          retainer_monthly: data.pricing?.retainer_monthly ?? data.project?.monthly_fee ?? null,
        },
        quotes: migratedQuotes,
        outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
        dashboard: data.dashboard || { visible_panels: {}, panel_types: {} },
      };
      const quoteTotal = migratedQuotes.reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0);
      const acceptedTotal = migratedQuotes.filter((quote: any) => quote.status === "accepted").reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0);
      migrated.project = { status: "prospecto", estimated_value: quoteTotal || null, contracted_value: acceptedTotal || null, monthly_fee: null, next_billing_date: null, ...(data.project || {}) };
      delete migrated.time_entries;
      await writeTextFile(path, JSON.stringify(migrated, null, 2));
      data = migrated;
    }
    return {
      version: 2,
      currency: "USD",
      project: { status: "prospecto", estimated_value: null, contracted_value: null, monthly_fee: null, next_billing_date: null },
      profile: { description: "", services: [], target_clients: [] },
      pricing: { model: "value_based", objective: "", expected_impact: "", value_hypothesis: "", success_metrics: [], retainer_monthly: null },
      dashboard: { visible_panels: {}, panel_types: {} },
      opportunities: [], estimates: [], quotes: [], outcomes: [], milestones: [], payments: [], expenses: [], invoices: [], notes: [],
      updated_at: new Date().toISOString(),
      ...data,
      project: { status: "prospecto", estimated_value: null, contracted_value: null, monthly_fee: null, next_billing_date: null, ...(data.project || {}) },
      pricing: { model: "value_based", objective: "", expected_impact: "", value_hypothesis: "", success_metrics: [], retainer_monthly: null, ...(data.pricing || {}) },
      dashboard: { visible_panels: {}, panel_types: {}, ...(data.dashboard || {}) },
      outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
    };
  } catch { return null; }
};

export const ensureBusinessWorkspace = async (projectPath: string) => {
  const current = await readBusinessWorkspace(projectPath);
  if (current) return current;
  const workspace: BusinessWorkspace = {
    version: 2,
    currency: "USD",
    project: { status: "prospecto", estimated_value: null, contracted_value: null, monthly_fee: null, next_billing_date: null },
    profile: { description: "", services: [], target_clients: [] },
    pricing: { model: "value_based", objective: "", expected_impact: "", value_hypothesis: "", success_metrics: [], retainer_monthly: null },
    dashboard: { visible_panels: {}, panel_types: {} },
    opportunities: [], estimates: [], quotes: [], outcomes: [], milestones: [], payments: [], expenses: [], invoices: [], notes: [],
    updated_at: new Date().toISOString(),
  };
  await ensureCodeclubFolder(projectPath);
  await writeTextFile(await getBusinessWorkspacePath(projectPath), JSON.stringify(workspace, null, 2));
  return workspace;
};

export const writeBusinessWorkspace = async (projectPath: string, workspace: BusinessWorkspace) => {
  await ensureCodeclubFolder(projectPath);
  const next = { ...workspace, version: 2 as const, updated_at: new Date().toISOString() };
  await writeTextFile(await getBusinessWorkspacePath(projectPath), JSON.stringify(next, null, 2));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("codeclub:business-updated", { detail: { projectPath } }));
  return next;
};

export const ensureProjectProfile = async (projectPath: string) => {
  await ensureCodeclubFolder(projectPath);
  const profilePath = await join(projectPath, ".codeclub", "profiles.json");
  let profiles: CodeclubProfile[] = [];
  if (await exists(profilePath)) {
    try {
      const parsed = JSON.parse(await readTextFile(profilePath));
      profiles = Array.isArray(parsed) ? parsed : [];
    } catch { profiles = []; }
  }
  const name = await invoke<string>("codeclub_get_username").catch(() => "Usuario");
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "usuario";
  const now = new Date().toISOString();
  const existing = profiles.find((profile) => profile.id === id);
  if (existing) existing.last_seen = now;
  else profiles.push({ id, name: name.trim() || "Usuario", role: "Developer", created_at: now, last_seen: now });
  await writeTextFile(profilePath, JSON.stringify(profiles, null, 2));
  return profiles;
};

export const indexProjectContents = async (name: string, projectPath: string) => {
  await ensureProjectProfile(projectPath);
  await ensureBusinessWorkspace(projectPath);
  const snapshot = await invoke<ProjectIndexSnapshot>("codeclub_index_project", { projectPath });
  const projects = await readProjectIndex();
  const existing = projects.find((project) => project.path === projectPath);
  const entry: ProjectEntry = {
    ...(existing || {}),
    name,
    path: projectPath,
    file_count: snapshot.fileCount,
    directory_count: snapshot.directoryCount,
    total_size: snapshot.totalSize,
    files: snapshot.files,
    indexed_at: new Date().toISOString(),
  };
  const next = existing ? projects.map((project) => project.path === projectPath ? entry : project) : [...projects, entry];
  await writeProjectIndex(next);
  return entry;
};

export const writeProjectIndex = async (projects: ProjectEntry[]) => {
  const configPath = await appConfigDir();
  const payload = JSON.stringify(projects);
  await mkdir(configPath, { recursive: true });
  await writeTextFile(await getAppConfigFilePath(PROJECTS_INDEX), payload);
  await writeTextFile(await getAppConfigFilePath(PROJECTS_BACKUP_INDEX), payload);
};

export const readProjectIndex = async (): Promise<ProjectEntry[]> => {
  const candidates = [PROJECTS_INDEX, PROJECTS_BACKUP_INDEX];
  for (const fileName of candidates) {
    const path = await getAppConfigFilePath(fileName);
    try {
      if (!(await exists(path))) continue;
      const data = await readTextFile(path);
      const projects = data ? JSON.parse(data) : [];
      await logPersistence("read_project_index", "ok", { path, count: projects.length });
      return Array.isArray(projects) ? projects : [];
    } catch (error: any) {
      await logPersistence("read_project_index", "error", { path, error: error?.message || String(error) });
    }
  }
  return [];
};
