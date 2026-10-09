import type { AgentPlugin } from './agent-plugins';

export type OrbDefinition = { id: string; name: string; purpose: string; color: string; providerId: string; modelId: string; allowComputer?: boolean };
export type ChatResource = {
  id: string;
  kind: 'plugin' | 'mcp' | 'orb' | 'skill' | 'extension';
  name: string;
  scope: 'global' | 'project';
  pluginId?: string;
  serverName?: string;
  skillId?: string;
  readOnly?: boolean;
};

/** References contain identity only: never MCP headers, environment values or credentials. */
export function chatResources(plugins: AgentPlugin[], orbs: OrbDefinition[]): ChatResource[] {
  return [
    ...plugins.flatMap(plugin => [
      { id: `plugin:${plugin.scope}:${plugin.id}`, kind: 'plugin' as const, name: plugin.name, scope: plugin.scope, pluginId: plugin.id, readOnly: !!plugin.builtIn },
      ...Object.keys(plugin.mcpServers).map(serverName => ({ id: `mcp:${plugin.scope}:${plugin.id}:${serverName}`, kind: 'mcp' as const, name: serverName, scope: plugin.scope, pluginId: plugin.id, serverName, readOnly: !!plugin.builtIn })),
    ]),
    ...orbs.map(orb => ({ id: orb.id, kind: 'orb' as const, name: orb.name, scope: 'global' as const })),
  ];
}

export const ORBS_STORAGE_KEY = 'codeclub_orbs';

export function parseOrbs(value: unknown): OrbDefinition[] {
  return Array.isArray(value) ? value.filter((orb): orb is OrbDefinition => !!orb && typeof orb.id === 'string' && typeof orb.name === 'string') : [];
}
