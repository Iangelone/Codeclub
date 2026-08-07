import { invoke } from '@tauri-apps/api/core';
import { jsonSchema } from 'ai';

export type AgentPluginSkill = {
  id: string;
  name: string;
  description: string;
  content: string;
  pluginName: string;
  pluginRoot?: string;
};

export type AgentPluginServer = {
  type: 'stdio' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
};

export type AgentPlugin = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  root: string;
  source: string;
  skills: AgentPluginSkill[];
  mcpServers: Record<string, AgentPluginServer>;
  warnings: string[];
};

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
type McpStartResult = { sessionId: string; tools: McpTool[] };

export async function loadAgentPlugins(projectPath: string): Promise<AgentPlugin[]> {
  return invoke<AgentPlugin[]>('codeclub_list_agent_plugins', { projectPath });
}

const replacePluginVariables = (value: string, root: string, data: string) => value.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${PLUGIN_DATA}', data);

function makeStdioTools(plugin: AgentPlugin, serverName: string, server: AgentPluginServer, dataPath: string, sessions: string[]) {
  let startPromise: Promise<McpStartResult> | undefined;
  const start = () => {
    startPromise ||= invoke<McpStartResult>('codeclub_mcp_stdio_start', {
      request: {
        pluginRoot: plugin.root,
        pluginData: dataPath,
        name: serverName,
        command: server.command,
        args: server.args || [],
        env: server.env || {},
        cwd: server.cwd ? replacePluginVariables(server.cwd, plugin.root, dataPath) : undefined,
      },
    }).then((result) => { sessions.push(result.sessionId); return result; });
    return startPromise;
  };
  return async () => {
    const result = await start();
    return Object.fromEntries((result.tools || []).map((definition) => {
      const toolName = `mcp_${plugin.id}_${serverName}_${definition.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
      return [toolName, {
        description: definition.description || `Tool ${definition.name} del plugin ${plugin.name}.`,
        inputSchema: jsonSchema(definition.inputSchema || { type: 'object', properties: {}, additionalProperties: false }),
        execute: (arguments_: unknown) => invoke('codeclub_mcp_stdio_call', { request: { sessionId: result.sessionId, name: definition.name, arguments: arguments_ || {} } }),
      }];
    }));
  };
}

export async function connectAgentPluginMcp(plugin: AgentPlugin) {
  const tools: Record<string, any> = {};
  const closeCallbacks: Array<() => Promise<void>> = [];
  const sessions: string[] = [];
  const dataPath = await invoke<string>('codeclub_agent_plugin_data', { pluginId: plugin.id });
  for (const [serverName, server] of Object.entries(plugin.mcpServers || {})) {
    try {
      if (server.type === 'stdio') {
        const serverTools = await makeStdioTools(plugin, serverName, server, dataPath, sessions)();
        Object.assign(tools, serverTools);
        continue;
      }
      if (!server.url) continue;
      const { createMCPClient } = await import('@ai-sdk/mcp');
      const client = await createMCPClient({
        transport: server.type === 'sse'
          ? { type: 'sse', url: server.url, headers: server.headers }
          : { type: 'http', url: server.url, headers: server.headers },
      } as any);
      const serverTools = await client.tools();
      const prefix = `mcp_${plugin.id}_${serverName}`.replace(/[^a-zA-Z0-9_]/g, '_');
      Object.entries(serverTools).forEach(([name, tool]) => { tools[`${prefix}_${name}`] = tool; });
      closeCallbacks.push(() => client.close());
    } catch (error) {
      console.warn(`No se pudo conectar MCP del plugin ${plugin.name}/${serverName}:`, error);
    }
  }
  closeCallbacks.push(async () => {
    await Promise.all(sessions.map((sessionId) => invoke('codeclub_mcp_stdio_close', { sessionId }).catch(() => undefined)));
  });
  return { tools, close: async () => Promise.all(closeCallbacks.map((close) => close())) };
}

export async function connectAllAgentPluginMcp(plugins: AgentPlugin[]) {
  const connected = await Promise.all(plugins.map((plugin) => connectAgentPluginMcp(plugin).catch((error) => {
    console.warn(`No se pudo cargar MCP del plugin ${plugin.name}:`, error);
    return { tools: {}, close: async () => undefined };
  })));
  return {
    tools: Object.assign({}, ...connected.map((item) => item.tools)),
    close: async () => Promise.all(connected.map((item) => item.close())),
  };
}
