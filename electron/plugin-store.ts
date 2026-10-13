/** Local plugin/skill discovery and existing plugin storage boundaries. */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectStorageKey } from './project-files.js';

type PluginScope = 'global' | 'project';
export const validPluginId = (value: string) => /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(value) && value.length <= 64 && !value.includes('..');
export const normalizePluginScope = (value: unknown, projectPath: string): PluginScope => {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'global') return 'global';
  if (scope === 'project' && String(projectPath || '').trim()) return 'project';
  if (scope === 'project') throw new Error('Se necesita un proyecto activo para usar el alcance del proyecto.');
  return String(projectPath || '').trim() ? 'project' : 'global';
};
const pluginRoot = (scope: PluginScope, projectPath: string) => scope === 'global'
  ? path.join(app.getPath('userData'), 'plugins')
  : path.join(app.getPath('userData'), 'projects', projectStorageKey(projectPath), 'plugins');
export const pluginDirectory = (scope: PluginScope, projectPath: string, pluginId: string) => {
  if (!validPluginId(pluginId)) throw new Error('El identificador del plugin no es válido.');
  return path.join(pluginRoot(scope, projectPath), pluginId);
};
const pluginFile = (scope: PluginScope, projectPath: string, pluginId: string, relativePath: string) => {
  const root = pluginDirectory(scope, projectPath, pluginId);
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('La ruta queda fuera del plugin.');
  return target;
};

/** Resolve existing ancestors as well as lexical paths, so plugin junctions cannot escape storage. */
export async function safePluginFile(scope: PluginScope, projectPath: string, pluginId: string, relativePath: string, create = false) {
  const storage = pluginRoot(scope, projectPath);
  const target = pluginFile(scope, projectPath, pluginId, relativePath);
  if (create) await fs.mkdir(storage, { recursive: true });
  const realStorage = await fs.realpath(storage);
  let ancestor = target;
  while (true) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      const relative = path.relative(realStorage, realAncestor);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La ruta real queda fuera del almacenamiento de plugins.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return target;
}

const bundledAgentSkillsRoot = () => path.join(
  app.isPackaged ? process.resourcesPath : app.getAppPath(),
  app.isPackaged ? 'agent-skills' : path.join('vendor', 'agent-skills'),
);

async function loadSkillInstructions(pluginRootPath: string, skillPath: string) {
  const original = await fs.readFile(skillPath, 'utf8');
  const resources = new Map<string, string>();
  const pending: Array<{ source: string; reference: string }> = [];
  const queueReferences = (source: string, content: string) => {
    const matches = content.match(/(?:(?:\.\.\/)+)?(?:references|scripts)\/[A-Za-z0-9_./-]+/g) || [];
    for (const reference of matches) pending.push({ source, reference: reference.replace(/[.,;:!?]+$/, '') });
  };
  queueReferences(skillPath, original);

  while (pending.length && resources.size < 16) {
    const { source, reference } = pending.shift()!;
    const target = path.resolve(path.dirname(source), reference);
    const relative = path.relative(pluginRootPath, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || resources.has(relative)) continue;
    try {
      const [realRoot, realTarget] = await Promise.all([fs.realpath(pluginRootPath), fs.realpath(target)]);
      const realRelative = path.relative(realRoot, realTarget);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
      const content = await fs.readFile(realTarget, 'utf8');
      if (content.length > 200_000) continue;
      resources.set(realRelative, content);
      queueReferences(realTarget, content);
    } catch {
      // Some upstream skills mention host-specific files that are not part of the skill bundle.
    }
  }

  if (!resources.size) return original;
  const appendix = Array.from(resources, ([relative, content]) => `### ${relative}\n\n${content}`).join('\n\n');
  return `${original}\n\n## Supporting files included with this skill\n\n${appendix}`;
}

export async function listAgentPlugins(projectPath: string) {
  const roots = [
    ...(String(projectPath || '').trim() ? [{ root: pluginRoot('project', projectPath), scope: 'project' as PluginScope }] : []),
    { root: pluginRoot('global', projectPath), scope: 'global' as PluginScope },
    { root: bundledAgentSkillsRoot(), scope: 'global' as PluginScope, builtIn: true },
  ];
  const plugins: any[] = [];
  const seen = new Set<string>();
  for (const entry of roots) {
    let children: any[] = [];
    try { children = await fs.readdir(entry.root, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const root = path.join(entry.root, child.name);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
        const id = String(manifest.name || child.name);
        if (seen.has(id)) continue;
        seen.add(id);
        const skills: any[] = [];
        const skillsRoot = path.join(root, 'skills');
        for (const skill of await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => [] as any[])) {
          if (!skill.isDirectory()) continue;
          const skillPath = path.join(skillsRoot, skill.name, 'SKILL.md');
          try {
            const content = await loadSkillInstructions(root, skillPath);
            const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
            const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim();
            if (name && description) skills.push({ id: skill.name, name, description, content, pluginName: id, scope: entry.scope });
          } catch { /* Skill incompleta: se omite. */ }
        }
        let mcpServers: Record<string, unknown> = {};
        try { const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp.json'), 'utf8')); mcpServers = mcp.mcpServers || {}; } catch { /* MCP opcional. */ }
        plugins.push({ id, name: manifest.displayName || manifest.interface?.displayName || id, version: manifest.version, description: manifest.description, root, source: entry.scope, scope: entry.scope, projectPath: entry.scope === 'project' ? path.resolve(projectPath) : undefined, skills, mcpServers, warnings: [], builtIn: entry.builtIn === true });
      } catch { /* Invalid manifest: skip loading. */ }
    }
  }
  return plugins.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}
