import { jsonSchema, tool } from 'ai';
import { nativeInvoke as invoke } from '../runtime';
import { loadAgentPlugins } from '../agent-plugins';
import { codeclubExtensions } from '../extensions';
import { getSetting, setSetting } from '../persistence';
import { chatResources, ORBS_STORAGE_KEY, parseOrbs, type OrbDefinition } from '../chat-resources';
import type { ToolContext } from './types';

const schema = (properties: Record<string, any>, required: string[]) => jsonSchema<any>({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string' };
const scopeSchema = { type: 'string', enum: ['global', 'project'] };

export function createResourceTools(ctx: ToolContext) {
  const projectPath = ctx.projectScoped ? ctx.projectPath : '';
  const changed = (scope: string) => {
    for (const name of ['skills', 'extensions', 'mcp']) window.dispatchEvent(new CustomEvent(`codeclub:${name}-changed`, { detail: { projectPath: scope === 'project' ? projectPath : '' } }));
  };
  const pluginFor = async (pluginId: string, scope: string) => {
    if (scope === 'project' && !projectPath) throw new Error('Seleccioná un proyecto.');
    const plugin = (await loadAgentPlugins(projectPath)).find(item => item.id === pluginId && item.scope === scope);
    if (!plugin) throw new Error('Plugin no encontrado en el alcance indicado.');
    return plugin;
  };
  const mutablePlugin = async (pluginId: string, scope: string) => {
    const plugin = await pluginFor(pluginId, scope);
    if (plugin.builtIn) throw new Error('El plugin integrado es de solo lectura. Creá una copia personal para modificarlo.');
    return plugin;
  };
  const read = async (pluginId: string, scope: string, path: string) => (await invoke<any>('codeclub_agent_plugin_read_file', { projectPath, pluginId, scope, path })).content as string;
  const write = async (pluginId: string, scope: string, path: string, content: string) => invoke<any>('codeclub_agent_plugin_write_file', { projectPath, pluginId, scope, path, content });
  const approve = (toolName: string, input: unknown, summary: string) => ctx.requestToolApproval({ toolName, input, summary });

  return {
    listResources: tool({
      description: 'List all built-in extensions, installed plugins, skills, MCP server identities and global orbs. No secrets or MCP configuration values are included. Project packages follow normal project precedence.',
      inputSchema: schema({}, []),
      execute: async () => {
        const plugins = await loadAgentPlugins(projectPath);
        return { extensions: codeclubExtensions.map(({ id, name, description }) => ({ id, name, description, readOnly: true })), resources: chatResources(plugins, parseOrbs(await getSetting(ORBS_STORAGE_KEY, []))), skills: plugins.flatMap(plugin => plugin.skills.map(skill => ({ id: skill.id, name: skill.name, pluginId: plugin.id, scope: plugin.scope, readOnly: !!plugin.builtIn }))) };
      },
    }),
    editPluginResource: tool({
      description: 'Read or edit an existing plugin manifest or a skill SKILL.md. Supply exact pluginId and scope from listResources. Read before writing; preserve unrelated manifest fields. Built-ins are read-only. Use createExtension/createSkill for new packages and manageMcpServer for MCP configuration.',
      inputSchema: schema({ action: { type: 'string', enum: ['read', 'write'] }, pluginId: text, scope: scopeSchema, path: text, content: text }, ['action', 'pluginId', 'scope', 'path']),
      execute: async ({ action, pluginId, scope, path, content }) => {
        const plugin = await pluginFor(pluginId, scope);
        if (path !== 'plugin.json' && !/^skills\/[a-zA-Z0-9_-]+\/SKILL\.md$/.test(path)) throw new Error('Solo se admite plugin.json o skills/<nombre>/SKILL.md.');
        if (action === 'read') {
          if (plugin.builtIn) {
            const skill = plugin.skills.find(item => `skills/${item.id}/SKILL.md` === path);
            return skill ? { content: skill.content, readOnly: true } : { id: plugin.id, name: plugin.name, description: plugin.description, readOnly: true };
          }
          return { content: await read(pluginId, scope, path) };
        }
        await mutablePlugin(pluginId, scope);
        if (typeof content !== 'string' || !content.trim()) throw new Error('El contenido no puede estar vacío.');
        if (path === 'plugin.json') {
          const manifest = JSON.parse(content);
          if (manifest.name !== pluginId || typeof manifest.version !== 'string') throw new Error('Conservá el nombre del plugin y una versión válida.');
        }
        const result = await write(pluginId, scope, path, content);
        const verified = await read(pluginId, scope, path) === content;
        changed(scope);
        ctx.recordToolEvent('editPluginResource', { action, pluginId, scope, path }, { ...result, verified });
        return { ...result, verified };
      },
    }),
    deleteSkill: tool({
      description: 'Delete only the named skill inside an existing plugin, preserving its other skills and MCP servers. Exact pluginId, scope and skillId are required. Requests approval for that exact target; built-ins are read-only.',
      inputSchema: schema({ pluginId: text, scope: scopeSchema, skillId: text }, ['pluginId', 'scope', 'skillId']),
      execute: async input => {
        const plugin = await mutablePlugin(input.pluginId, input.scope);
        if (!plugin.skills.some(skill => skill.id === input.skillId)) throw new Error('Skill no encontrada.');
        if (!await approve('deleteSkill', input, `Eliminar skill ${input.skillId} de ${input.pluginId} (${input.scope})`)) return { ok: false, cancelled: true };
        const result = await invoke('codeclub_agent_plugin_remove_skill', { projectPath, ...input });
        changed(input.scope);
        ctx.recordToolEvent('deleteSkill', input, result);
        return result;
      },
    }),
    manageMcpServer: tool({
      description: 'Inspect, update or remove one MCP server in an existing plugin without deleting its sibling servers or skills. Supply exact pluginId, scope and serverName. Update accepts a JSON object containing only changed fields; omitted fields including credentials are preserved. Never put credentials in tool arguments. Inspect returns field names and transport only, never secret values. Removal requests approval. Changes apply on the next message.',
      inputSchema: schema({ action: { type: 'string', enum: ['inspect', 'update', 'remove'] }, pluginId: text, scope: scopeSchema, serverName: text, configJson: text }, ['action', 'pluginId', 'scope', 'serverName']),
      execute: async ({ action, pluginId, scope, serverName, configJson }) => {
        const plugin = await pluginFor(pluginId, scope);
        if (action === 'inspect') {
          const server = plugin.mcpServers[serverName];
          if (!server) throw new Error('Servidor MCP no encontrado.');
          return { pluginId, scope, serverName, type: server.type, fields: Object.keys(server), readOnly: !!plugin.builtIn };
        }
        await mutablePlugin(pluginId, scope);
        const config = JSON.parse(await read(pluginId, scope, 'mcp.json'));
        if (!Object.hasOwn(config.mcpServers || {}, serverName)) throw new Error('Servidor MCP no encontrado.');
        if (action === 'remove') {
          if (!await approve('manageMcpServer', { action, pluginId, scope, serverName }, `Eliminar MCP ${serverName} de ${pluginId} (${scope})`)) return { ok: false, cancelled: true };
          delete config.mcpServers[serverName];
        } else {
          if (!configJson?.trim()) throw new Error('update requiere configJson con los campos a modificar.');
          const patch = JSON.parse(configJson);
          if (!patch || Array.isArray(patch) || typeof patch !== 'object') throw new Error('El parche MCP debe ser un objeto JSON.');
          const next = { ...config.mcpServers[serverName], ...patch };
          if (!['stdio', 'streamable-http', 'sse'].includes(next.type) || (next.type === 'stdio' ? !next.command : !next.url)) throw new Error('Configuración MCP inválida.');
          config.mcpServers[serverName] = next;
        }
        await write(pluginId, scope, 'mcp.json', JSON.stringify(config, null, 2) + '\n');
        changed(scope);
        const result = { ok: true, action, pluginId, scope, serverName, availableNextMessage: true };
        ctx.recordToolEvent('manageMcpServer', { action, pluginId, scope, serverName }, result);
        return result;
      },
    }),
    manageOrb: tool({
      description: 'List, create, edit, remove, run or pause global orbs shown in the Orbs panel. Creation needs name and purpose, defaults to the current provider/model, and does not start execution. Edit preserves unchanged fields. Remove requests approval and requires an inactive orb. Never store credentials in orb data.',
      inputSchema: schema({ action: { type: 'string', enum: ['list', 'create', 'update', 'remove', 'run', 'pause'] }, id: text, name: text, purpose: text, color: text, providerId: text, modelId: text }, ['action']),
      execute: async input => {
        const orbs = parseOrbs(await getSetting(ORBS_STORAGE_KEY, []));
        if (input.action === 'list') return { orbs };
        const old = orbs.find(orb => orb.id === input.id);
        if (input.action === 'create' && old) throw new Error('El id ya existe. Usá update para modificar el orbe.');
        if (input.action !== 'create' && !old) throw new Error('Orbe no encontrado. Usá listResources o manageOrb list.');
        const tasks = await invoke<any[]>('codeclub_scheduled_list', { projectPath: '' });
        const task = old && tasks.find(item => item.id === `orb_${old.id}`);
        if (input.action === 'run' || input.action === 'pause') {
          if (input.action === 'run') {
            await invoke('codeclub_scheduled_save', { projectPath: '', task: { ...task, id: `orb_${old!.id}`, name: old!.name, prompt: old!.purpose, provider: old!.providerId, model: old!.modelId, autonomous: true, status: 'active', interval: task?.interval || 'Personalizado', every: task?.every || '30 min', notifications: task?.notifications || 'Solo errores' } });
            return invoke('codeclub_scheduled_run', { projectPath: '', id: `orb_${old!.id}` });
          }
          if (task) await invoke('codeclub_scheduled_status', { projectPath: '', id: task.id, paused: true });
          if (task) await (window as any).codeclub.tasksCancel('', task.id);
          return { ok: true };
        }
        let next: OrbDefinition[];
        if (input.action === 'remove') {
          if (!await approve('manageOrb', { action: input.action, id: old!.id }, `Eliminar orbe ${old!.name} (${old!.id})`)) return { ok: false, cancelled: true };
          if (task) await invoke('codeclub_scheduled_remove', { projectPath: '', id: task.id });
          next = orbs.filter(orb => orb.id !== old!.id);
        } else {
          const orb: OrbDefinition = { id: old?.id || crypto.randomUUID(), name: input.name ?? old?.name ?? '', purpose: input.purpose ?? old?.purpose ?? '', color: input.color ?? old?.color ?? '#2d5fd6', providerId: input.providerId ?? old?.providerId ?? ctx.providerId ?? '', modelId: input.modelId ?? old?.modelId ?? ctx.modelId ?? '' };
          if (!orb.name.trim() || orb.name.length > 200 || !orb.purpose.trim() || orb.purpose.length > 100000 || !orb.providerId || !orb.modelId || !/^#[0-9a-f]{6}$/i.test(orb.color)) throw new Error('Datos del orbe inválidos: nombre, propósito, proveedor, modelo y color hexadecimal requeridos.');
          if (task) await invoke('codeclub_scheduled_save', { projectPath: '', task: { ...task, name: orb.name, prompt: orb.purpose, provider: orb.providerId, model: orb.modelId } });
          next = old ? orbs.map(item => item.id === old.id ? orb : item) : [...orbs, orb];
          input = { ...input, id: orb.id };
        }
        await setSetting(ORBS_STORAGE_KEY, next);
        window.dispatchEvent(new CustomEvent('codeclub:orbs-changed'));
        const result = { ok: true, action: input.action, id: input.id };
        ctx.recordToolEvent('manageOrb', { action: input.action, id: input.id }, result);
        return result;
      },
    }),
  };
}
