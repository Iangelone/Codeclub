export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface PlanStep {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface AgentPlan {
  id: string;
  title: string;
  status: TaskStatus;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentState {
  plan: AgentPlan | null;
  todos: TodoItem[];
}

const statePath = (projectPath: string) => `${projectPath}/.codeclub/agent-state.json`;

export async function readAgentState(projectPath: string): Promise<AgentState> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs');
  const path = statePath(projectPath);
  if (!(await exists(path))) return { plan: null, todos: [] };
  try {
    return JSON.parse(await readTextFile(path));
  } catch {
    return { plan: null, todos: [] };
  }
}

export async function writeAgentState(projectPath: string, state: AgentState): Promise<void> {
  const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
  await mkdir(`${projectPath}/.codeclub`, { recursive: true });
  await writeTextFile(statePath(projectPath), JSON.stringify(state));
}

export const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
