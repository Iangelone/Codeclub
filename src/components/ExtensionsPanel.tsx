import React, { useEffect, useMemo, useState } from 'react';
import { Blocks, Box, FileText, FileType2, Folder, LayoutTemplate, PlugZap, Presentation, Search, Table2, Trash2, WandSparkles } from 'lucide-react';
import { getSetting, setSetting } from '../lib/persistence';
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';
import { loadAgentPlugins, type AgentPlugin } from '../lib/agent-plugins';
import { nativeInvoke as invoke } from '../lib/runtime';

const builtInExtensions = [
  { id: 'documents', name: 'Documents', description: 'Create and edit document artifacts', icon: FileText, color: '#1687FF' },
  { id: 'pdf', name: 'PDF', description: 'Read, create, and verify PDF files', icon: FileType2, color: '#ff5d62' },
  { id: 'spreadsheets', name: 'Spreadsheets', description: 'Create and edit spreadsheet files', icon: Table2, color: '#2e9b3f' },
  { id: 'presentations', name: 'Presentations', description: 'Create and edit presentation artifacts', icon: Presentation, color: '#e99a1a' },
  { id: 'template-creator', name: 'Template Creator', description: 'Create or update reusable templates from reference content', icon: LayoutTemplate, color: '#17b9ef' },
];

type Scope = 'global' | 'project';
type ExtensionItem = { id: string; name: string; description: string; icon: typeof Box; color: string; scope: Scope; protected?: boolean };
type SkillItem = { id: string; name: string; description: string; source: string; scope: Scope };
type McpItem = { id: string; name: string; url: string; scope: Scope };

const scopeLabel = (scope: Scope, language: AppLanguage) => scope === 'global' ? (language === 'en' ? 'Global' : 'Global') : (language === 'en' ? 'Project' : 'Proyecto');

export default function ExtensionsPanel({ selectedProject }: { selectedProject?: { projectPath: string } | null }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const [tab, setTab] = useState<'extensions' | 'skills' | 'mcp'>('extensions');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpItem[]>([]);
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const projectPath = selectedProject?.projectPath || '';
  const pluginExtensions = useMemo<ExtensionItem[]>(() => plugins.map((plugin) => ({
    id: `plugin:${plugin.id}`,
    name: plugin.name,
    description: plugin.description || 'Agent Plugin instalado',
    icon: Blocks,
    color: '#8BC7FF',
    scope: plugin.scope,
  })), [plugins]);
  const allExtensions = useMemo<ExtensionItem[]>(() => [
    ...builtInExtensions.map((extension) => ({ ...extension, scope: 'global' as const, protected: true })),
    ...pluginExtensions,
  ], [pluginExtensions]);
  const filteredExtensions = useMemo(() => allExtensions.filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes(query.toLowerCase())), [allExtensions, query]);
  const filteredSkills = useMemo(() => skills.filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.toLowerCase())), [skills, query]);

  const text = language === 'en'
    ? { title: 'Extensions', description: 'Manage extensions, skills, and MCP by scope.', extensions: 'Extensions', skills: 'Skills', search: 'Search', list: 'Available extensions', empty: 'No extensions found.', noSkills: 'No SKILL.md files found.', noMcp: 'No MCP servers connected.', project: 'Active project', noProject: 'No active project: only global items are shown.' }
    : { title: 'Extensiones', description: 'Administrá extensiones, skills y MCP por alcance.', extensions: 'Extensiones', skills: 'Skills', search: 'Buscar', list: 'Extensiones disponibles', empty: 'No se encontraron extensiones.', noSkills: 'No se encontraron archivos SKILL.md.', noMcp: 'No hay servidores MCP conectados.', project: 'Proyecto activo', noProject: 'Sin proyecto activo: solo se muestran elementos globales.' };

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  const refresh = () => {
    void Promise.all(builtInExtensions.map(async (extension) => [extension.id, await getSetting(`codeclub_extension_enabled_${extension.id}`, 'true') !== 'false'] as const))
      .then((entries) => setEnabled(Object.fromEntries(entries)));
    void loadAgentPlugins(projectPath).then((discovered) => {
      setPlugins(discovered || []);
      setSkills((discovered || []).flatMap((plugin) => plugin.skills.map((skill) => ({ id: `${plugin.id}:${skill.id}`, name: skill.name, description: skill.description, source: plugin.name, scope: skill.scope }))));
      const pluginServers = (discovered || []).flatMap((plugin) => Object.entries(plugin.mcpServers || {}).map(([name, server]) => ({ id: `${plugin.id}:${name}`, name: `${plugin.name} · ${name}`, url: server.url || `${server.type} · ${server.command || ''}`, scope: plugin.scope })));
      setMcpServers(pluginServers);
    }).catch(() => { setSkills([]); setPlugins([]); setMcpServers([]); });
  };

  useEffect(() => {
    refresh();
    const events = ['codeclub:extensions-changed', 'codeclub:skills-changed', 'codeclub:mcp-changed'];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => events.forEach((event) => window.removeEventListener(event, refresh));
  }, [projectPath]);


  return (
    <main className="extensions-panel-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[#1A1A1A]">
      <div className="mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7 lg:px-8">
        <header>
          <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h1>
          <p className="mt-1.5 text-[14px] text-[#999999]">{text.description}</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#777777]" title={projectPath || text.noProject}><Folder size={13} />{projectPath ? `${text.project}: ${projectPath.split(/[\\/]/).pop()}` : text.noProject}</p>
        </header>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-0.5 text-[13px] text-[#777777]" aria-label="Categorías de extensiones">
            {([{ id: 'extensions', label: text.extensions, count: allExtensions.length, icon: Blocks }, { id: 'skills', label: text.skills, count: skills.length, icon: WandSparkles }, { id: 'mcp', label: 'MCP', count: mcpServers.length, icon: PlugZap }] as const).map(({ id, label, count, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-label={`${label} ${count}`} className={`inline-flex items-center gap-1.5 rounded-[8px] border-0 px-3 py-1.5 ${tab === id ? 'bg-[#2b2b2b] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#202020]'}`}><Icon size={14} strokeWidth={1.8} className="shrink-0 text-[#eeeeee]" aria-hidden="true" />{label} <span className="text-[#999999]">{count}</span></button>)}
          </nav>
          <label className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-[9px] border border-[#3a3a3a] bg-[#202020] px-3 text-[#999999] focus-within:border-[#555555]"><Search size={16} strokeWidth={1.7} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} aria-label={text.search} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777]" /></label>
        </div>

        {tab === 'extensions' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label={text.list}>
          {filteredExtensions.map(({ id, name, description, icon: Icon = Box, color, scope, protected: isProtected }) => {
            const enabledKey = isProtected ? id : name;
            const isEnabled = enabled[enabledKey] ?? true;
            return <div key={id} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><div className="grid h-7 w-7 place-items-center rounded-[7px]" style={{ background: color }}><Icon size={17} strokeWidth={1.8} className="text-white" /></div></div>
              <div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{description}</p></div>
              <span className="shrink-0 rounded-full border border-[#303030] px-2 py-1 text-[10px] text-[#8f8f8f]">{scopeLabel(scope, language)}</span>
              <button type="button" role="switch" aria-checked={isEnabled} aria-label={`${isEnabled ? 'Desactivar' : 'Activar'} ${name}`} onClick={() => { const next = !isEnabled; setEnabled((current) => ({ ...current, [enabledKey]: next })); if (isProtected) void setSetting(`codeclub_extension_enabled_${id}`, String(next)); }} className={`relative h-6 w-10 shrink-0 rounded-full border-0 transition-colors ${isEnabled ? 'bg-[#3d9bff]' : 'bg-[#3a3a3a]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isEnabled ? 'right-1' : 'left-1'}`} /></button>
              {!isProtected && <button type="button" onClick={() => { void invoke('codeclub_delete_agent_plugin', { projectPath, pluginId: id.replace(/^plugin:/, ''), scope }).then(refresh).catch(() => undefined); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]" title="Eliminar plugin"><Trash2 size={14} /></button>}
            </div>;
          })}
          {filteredExtensions.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.empty}</div>}
        </section>}
        {tab === 'skills' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label="Skills disponibles">
          {filteredSkills.map((skill) => <div key={`${skill.source}-${skill.id}`} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><WandSparkles size={19} strokeWidth={1.7} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{skill.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{skill.description}</p></div><span className="shrink-0 text-[11px] text-[#777777]">{skill.source} · {scopeLabel(skill.scope, language)}</span></div>)}
          {filteredSkills.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.noSkills}</div>}
        </section>}
        {tab === 'mcp' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label="Servidores MCP">
          {mcpServers.map((server) => <div key={server.id} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><PlugZap size={19} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{server.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{server.url}</p></div><span className="shrink-0 text-[11px] text-[#777777]">{scopeLabel(server.scope, language)}</span></div>)}
          {mcpServers.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.noMcp}</div>}
        </section>}
      </div>
    </main>
  );
}
