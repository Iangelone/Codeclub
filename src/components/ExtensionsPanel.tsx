import React, { useEffect, useMemo, useState } from 'react';
import { Blocks, Box, FileText, FileType2, LayoutTemplate, Network, PlugZap, Plus, Presentation, Search, Table2, Trash2, WandSparkles } from 'lucide-react';
import { getSetting, setSetting } from '../lib/persistence';
import { protectedExtensionIds, type CodeclubExtension } from '../lib/extensions';
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';
import { loadAgentPlugins, type AgentPlugin } from '../lib/agent-plugins';

const extensions = [
  { id: 'documents', name: 'Documents', description: 'Create and edit document artifacts', icon: FileText, color: '#1687FF' },
  { id: 'pdf', name: 'PDF', description: 'Read, create, and verify PDF files', icon: FileType2, color: '#ff5d62' },
  { id: 'spreadsheets', name: 'Spreadsheets', description: 'Create and edit spreadsheet files', icon: Table2, color: '#2e9b3f' },
  { id: 'presentations', name: 'Presentations', description: 'Create and edit presentation artifacts', icon: Presentation, color: '#e99a1a' },
  { id: 'template-creator', name: 'Template Creator', description: 'Create or update reusable templates from reference content', icon: LayoutTemplate, color: '#17b9ef' },
];

export default function ExtensionsPanel({ selectedProject }: { selectedProject?: { projectPath: string } | null }) {
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = language === 'en' ? { title: 'Extensions', description: 'Manage extensions, skills, and MCP', categories: 'Extension categories', extensions: 'Extensions', skills: 'Skills', search: 'Search extensions', list: 'Extension list', disable: 'Disable', enable: 'Enable', customDelete: 'Delete custom extension', empty: 'No extensions found.' } : { title: 'Extensiones', description: 'Administrá extensiones, skills y MCP', categories: 'Categorías de extensiones', extensions: 'Extensiones', skills: 'Habilidades', search: 'Buscar extensiones', list: 'Lista de extensiones', disable: 'Desactivar', enable: 'Activar', customDelete: 'Eliminar extensión personalizada', empty: 'No se encontraron extensiones.' };
  const [tab, setTab] = useState<'extensions' | 'skills' | 'mcp'>('extensions');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(extensions.map(({ name }) => [name, true])));
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string; source: string }>>([]);
  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; url: string; enabled: boolean; source?: string }>>([]);
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [customExtensions, setCustomExtensions] = useState<CodeclubExtension[]>([]);
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpError, setMcpError] = useState('');
  const allExtensions = useMemo(() => [...extensions.map((extension) => ({ ...extension, protected: true })), ...customExtensions], [customExtensions]);
  const filteredExtensions = useMemo(() => allExtensions.filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes(query.toLowerCase())), [allExtensions, query]);

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (nextLanguage === 'es' || nextLanguage === 'en') setLanguage(nextLanguage);
    };
    window.addEventListener('codeclub:language-change', handleLanguageChange);
    return () => window.removeEventListener('codeclub:language-change', handleLanguageChange);
  }, []);

  useEffect(() => {
    void Promise.all(allExtensions.map(async (extension) => [extension.name, await getSetting(`codeclub_extension_enabled_${extension.id}`, 'true') !== 'false'] as const))
      .then((entries) => setEnabled(Object.fromEntries(entries)));
    void getSetting('codeclub_custom_extensions', '[]').then((raw) => { try { setCustomExtensions(JSON.parse(raw || '[]')); } catch { setCustomExtensions([]); } });
    void loadAgentPlugins(selectedProject?.projectPath || '').then((discovered) => {
      setPlugins(discovered || []);
      const pluginSkills = (discovered || []).flatMap((plugin) => plugin.skills.map((skill) => ({ id: `${plugin.id}:${skill.id}`, name: skill.name, description: skill.description, source: `plugin:${plugin.name}` })));
      setSkills(pluginSkills);
      const pluginServers = (discovered || []).flatMap((plugin) => Object.entries(plugin.mcpServers || {}).map(([name, server]) => ({ id: `${plugin.id}:${name}`, name: `${plugin.name} · ${name}`, url: server.url || `${server.type} · ${server.command || ''}`, enabled: true, source: 'plugin' })));
      setMcpServers((current) => [...current.filter((server) => server.source !== 'plugin'), ...pluginServers]);
    }).catch(() => { setSkills([]); setPlugins([]); });
    const refreshMcp = () => { void getSetting('codeclub_mcp_servers', '[]').then((raw) => { try { setMcpServers(JSON.parse(raw || '[]')); } catch { setMcpServers([]); } }); };
    void refreshMcp();
    const refreshExtensions = () => { void getSetting('codeclub_custom_extensions', '[]').then((raw) => { try { setCustomExtensions(JSON.parse(raw || '[]')); } catch { setCustomExtensions([]); } }); };
    window.addEventListener('codeclub:extensions-changed', refreshExtensions);
    window.addEventListener('codeclub:mcp-changed', refreshMcp);
    return () => { window.removeEventListener('codeclub:extensions-changed', refreshExtensions); window.removeEventListener('codeclub:mcp-changed', refreshMcp); };
  }, [selectedProject?.projectPath, allExtensions.length]);

  const saveMcpServers = (next: typeof mcpServers) => { setMcpServers(next); void setSetting('codeclub_mcp_servers', JSON.stringify(next)); };
  /* MCP servers are managed by the agent tools. */
  const addMcpServer = () => {
    const url = '';
    if (!/^https?:\/\/\S+$/i.test(url)) { setMcpError('Usá una URL HTTP(S) válida.'); return; }
    if (mcpServers.some((server) => server.url === url)) { setMcpError('Ese servidor ya está agregado.'); return; }
    saveMcpServers([...mcpServers, { id: crypto.randomUUID(), name: new URL(url).hostname, url, enabled: true }]);
    setMcpUrl('');
    setMcpError('');
  };

  return (
    <main className="extensions-panel-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[#1A1A1A]">
      <div className="mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7 lg:px-8">
        <header>
          <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h1>
          <p className="mt-1.5 text-[14px] text-[#999999]">{text.description}</p>
        </header>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-0.5 text-[13px] text-[#777777]" aria-label="Categorías de complementos">
            {([{ id: 'extensions', label: text.extensions, count: allExtensions.length, icon: Blocks }, { id: 'skills', label: text.skills, count: skills.length, icon: WandSparkles }, { id: 'mcp', label: 'MCP', count: mcpServers.length, icon: PlugZap }] as const).map(({ id, label, count, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-label={`${label} ${count}`} className={`inline-flex items-center gap-1.5 rounded-[8px] border-0 px-3 py-1.5 ${tab === id ? 'bg-[#2b2b2b] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#202020]'}`}><Icon size={14} strokeWidth={1.8} className="shrink-0 text-[#eeeeee]" aria-hidden="true" />{label} <span className="text-[#999999]">{count}</span></button>)}
          </nav>
          <label className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-[9px] border border-[#3a3a3a] bg-[#202020] px-3 text-[#999999] focus-within:border-[#555555]">
            <Search size={16} strokeWidth={1.7} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777]" />
          </label>
        </div>

        {tab === 'extensions' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label={text.list}>
          {filteredExtensions.map(({ id, name, description, icon: Icon = Box, color = '#1687FF' }) => {
            const isEnabled = enabled[name];
            const isProtected = protectedExtensionIds.has(id);
            return (
              <div key={name} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]">
                  <div className="grid h-7 w-7 place-items-center rounded-[7px]" style={{ background: color }}><Icon size={17} strokeWidth={1.8} className="text-white" /></div>
                </div>
                <div className="min-w-0 w-0 flex-1">
                  <h2 className="m-0 text-[14px] font-semibold text-[#eeeeee]">{name}</h2>
                  <p className="mt-0.5 truncate text-[13px] text-[#888888]">{description}</p>
                </div>
                <button type="button" role="switch" aria-checked={isEnabled} aria-label={`${isEnabled ? 'Desactivar' : 'Activar'} ${name}`} onClick={() => { const next = !isEnabled; setEnabled((current) => ({ ...current, [name]: next })); void setSetting(`codeclub_extension_enabled_${id}`, String(next)); window.dispatchEvent(new CustomEvent('codeclub:extensions-changed')); }} className={`relative h-6 w-10 shrink-0 rounded-full border-0 transition-colors ${isEnabled ? 'bg-[#3d9bff]' : 'bg-[#3a3a3a]'}`}>
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isEnabled ? 'right-1' : 'left-1'}`} />
                </button>
                {!isProtected && <button type="button" onClick={() => { void getSetting('codeclub_custom_extensions', '[]').then((raw) => { let items: any[] = []; try { items = JSON.parse(raw || '[]'); } catch {} const next = items.filter((item) => item.id !== id); void setSetting('codeclub_custom_extensions', JSON.stringify(next)); setCustomExtensions(next); window.dispatchEvent(new CustomEvent('codeclub:extensions-changed')); }); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]" title="Eliminar complemento personalizado"><Trash2 size={14} /></button>}
              </div>
            );
          })}
          {filteredExtensions.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.empty}</div>}
        </section>}
        {tab === 'skills' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label="Habilidades disponibles">
          {skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).map((skill) => <div key={`${skill.source}-${skill.id}`} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><Box size={19} strokeWidth={1.7} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{skill.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{skill.description}</p></div><span className="shrink-0 text-[11px] text-[#777777]">{skill.source.startsWith('plugin:') ? skill.source.slice(7) : 'Codeclub'}</span></div>)}
          {skills.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">No hay SKILL.md disponibles.</div>}
        </section>}
        {tab === 'mcp' && <section className="mt-9 grid min-w-0 gap-4" aria-label="Servidores MCP">
          <div className="rounded-lg border border-[#2d2d2d] bg-[#202020] p-3"><div className="mb-2 flex items-center gap-2 text-[13px] text-[#eeeeee]"><PlugZap size={16} className="text-[#8bc7ff]" />Conectar servidor MCP</div><div className="flex gap-2"><input value={mcpUrl} onChange={(event) => { setMcpUrl(event.target.value); setMcpError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') addMcpServer(); }} placeholder="https://tu-servidor/mcp" className="min-w-0 flex-1 rounded-md border border-[#3a3a3a] bg-[#161616] px-2.5 py-2 text-[12px] text-[#eeeeee] outline-none" /><button type="button" onClick={addMcpServer} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border-0 bg-[#1687ff] text-white"><Plus size={16} /></button></div>{mcpError && <p className="mt-2 text-[11px] text-[#ff9e94]">{mcpError}</p>}<p className="mt-2 text-[11px] text-[#777777]">Los tools habilitados se conectan al enviar el próximo mensaje.</p></div>
          {mcpServers.map((server) => <div key={server.id} className="flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><Network size={19} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{server.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{server.url}</p></div><button type="button" role="switch" aria-checked={server.enabled} onClick={() => saveMcpServers(mcpServers.map((item) => item.id === server.id ? { ...item, enabled: !item.enabled } : item))} className={`relative h-6 w-10 shrink-0 rounded-full border-0 ${server.enabled ? 'bg-[#3d9bff]' : 'bg-[#3a3a3a]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm ${server.enabled ? 'right-1' : 'left-1'}`} /></button><button type="button" onClick={() => saveMcpServers(mcpServers.filter((item) => item.id !== server.id))} className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]" title="Quitar servidor"><Trash2 size={14} /></button></div>)}
          {mcpServers.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">Todavía no conectaste servidores MCP.</div>}
        </section>}
      </div>
    </main>
  );
}
