import { getProjectFilePath } from '../persistence';
import { fileExists, makeDirectory, readDesktopText, writeDesktopText } from '../runtime';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';

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
  plans: AgentPlan[];
  todos: TodoItem[];
}

const statePath = (projectPath: string) => getProjectFilePath(projectPath, 'agent-state.json');
const stateMutationQueues = new Map<string, Promise<void>>();

export async function waitForAgentStateMutations(projectPath: string): Promise<void> {
  await stateMutationQueues.get(projectPath);
}

export async function readAgentState(projectPath: string): Promise<AgentState> {
  const path = await statePath(projectPath);
  if (!(await fileExists(path))) return { plan: null, plans: [], todos: [] };
  try {
    const data = JSON.parse(await readDesktopText(path));
    const plans = Array.isArray(data.plans) ? data.plans : data.plan ? [data.plan] : [];
    return { ...data, plans, plan: plans[plans.length - 1] || null, todos: Array.isArray(data.todos) ? data.todos : [] };
  } catch {
    return { plan: null, plans: [], todos: [] };
  }
}

export async function writeAgentState(projectPath: string, state: AgentState): Promise<void> {
  const path = await statePath(projectPath);
  await makeDirectory(await getProjectFilePath(projectPath));
  await writeDesktopText(path, JSON.stringify(state));
}

export async function updateAgentState(projectPath: string, mutate: (state: AgentState) => void | Promise<void>): Promise<AgentState> {
  const previous = stateMutationQueues.get(projectPath) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  stateMutationQueues.set(projectPath, queued);

  try {
    await previous;
    const state = await readAgentState(projectPath);
    await mutate(state);
    await writeAgentState(projectPath, state);
    return await readAgentState(projectPath);
  } finally {
    release();
    if (stateMutationQueues.get(projectPath) === queued) stateMutationQueues.delete(projectPath);
  }
}

export const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
