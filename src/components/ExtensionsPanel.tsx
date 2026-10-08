/** Manages built-in extensions and scoped Agent Plugin/skill/MCP entries through the native bridge. */
import { useEffect, useMemo, useState } from 'react';
import { Blocks, Box, Download, FileText, FileType2, Folder, Globe, LayoutTemplate, PlugZap, Presentation, Search, Table2, Trash2, WandSparkles } from 'lucide-react';
import { getSetting, setSetting } from '../lib/persistence';
import { extensionActionTranslations, useAppLanguage, type AppLanguage } from '../lib/i18n';
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
type ExtensionItem = { id: string; name: string; description: string; icon: typeof Box; color: string; scope: Scope; protected?: boolean; builtIn?: boolean };
type SkillItem = { id: string; name: string; description: string; source: string; scope: Scope };
type McpItem = { id: string; name: string; url: string; scope: Scope };
type BrowserManager = { id: string; name: string; installed: boolean; connected: boolean };

const scopeLabel = (scope: Scope, language: AppLanguage) => scope === 'global' ? (language === 'en' ? 'Global' : 'Global') : (language === 'en' ? 'Project' : 'Proyecto');

export default function ExtensionsPanel({ selectedProject }: { selectedProject?: { projectPath: string } | null }) {
  const language = useAppLanguage();
  const actions = extensionActionTranslations[language];
  const [tab, setTab] = useState<'extensions' | 'skills' | 'mcp'>('extensions');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpItem[]>([]);
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [browserManagers, setBrowserManagers] = useState<BrowserManager[]>([]);
  const [browserBusy, setBrowserBusy] = useState('');
  const [browserNotice, setBrowserNotice] = useState('');
  const [browserError, setBrowserError] = useState('');
  const projectPath = selectedProject?.projectPath || '';
  const pluginExtensions = useMemo<ExtensionItem[]>(() => plugins.map((plugin) => ({
    id: `plugin:${plugin.id}`,
    name: plugin.name,
    description: plugin.description || 'Agent Plugin instalado',
    icon: Blocks,
    color: '#8BC7FF',
    scope: plugin.scope,
    protected: plugin.builtIn,
    builtIn: plugin.builtIn,
  })), [plugins]);
  const localizedBuiltIns = language === 'en' ? builtInExtensions : builtInExtensions.map((extension) => ({
    ...extension,
    name: ({ documents: 'Documentos', spreadsheets: 'Hojas de cálculo', presentations: 'Presentaciones', 'template-creator': 'Creador de plantillas' } as Record<string, string>)[extension.id] || extension.name,
    description: ({ documents: 'Crear y editar documentos', pdf: 'Leer, crear y verificar archivos PDF', spreadsheets: 'Crear y editar hojas de cálculo', presentations: 'Crear y editar presentaciones', 'template-creator': 'Crear o actualizar plantillas reutilizables' } as Record<string, string>)[extension.id] || extension.description,
  }));
  const allExtensions = useMemo<ExtensionItem[]>(() => [
    { id: 'browser-control', name: 'Codeclub Browser Control', description: language === 'en' ? 'Control tabs in Chromium-based browsers' : 'Controlá pestañas de navegadores Chromium', icon: Globe, color: '#1687FF', scope: 'global', protected: true },
    ...localizedBuiltIns.map((extension) => ({ ...extension, scope: 'global' as const, protected: true })),
    ...pluginExtensions,
  ], [pluginExtensions, localizedBuiltIns, language]);
  const filteredExtensions = useMemo(() => allExtensions.filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes(query.toLowerCase())), [allExtensions, query]);
  const filteredSkills = useMemo(() => skills.filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.toLowerCase())), [skills, query]);

  const text = language === 'en'
    ? { title: 'Extensions', description: 'Manage extensions, skills, and MCP by scope.', extensions: 'Extensions', skills: 'Skills', search: 'Search', list: 'Available extensions', empty: 'No extensions found.', noSkills: 'No SKILL.md files found.', noMcp: 'No MCP servers connected.', project: 'Active project', noProject: 'No active project: only global items are shown.', categories: 'Extension categories', skillsList: 'Available skills', mcpList: 'MCP servers', deletePlugin: 'Delete plugin', disable: 'Disable', enable: 'Enable' }
    : { title: 'Extensiones', description: 'Administrá extensiones, skills y MCP por alcance.', extensions: 'Extensiones', skills: 'Skills', search: 'Buscar', list: 'Extensiones disponibles', empty: 'No se encontraron extensiones.', noSkills: 'No se encontraron archivos SKILL.md.', noMcp: 'No hay servidores MCP conectados.', project: 'Proyecto activo', noProject: 'Sin proyecto activo: solo se muestran elementos globales.', categories: 'Categorías de extensiones', skillsList: 'Habilidades disponibles', mcpList: 'Servidores MCP', deletePlugin: 'Eliminar plugin', disable: 'Desactivar', enable: 'Activar' };

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

  const refreshBrowserManagers = () => {
    void invoke<{ browsers?: BrowserManager[] }>('codeclub_browser_extension_info')
      .then((result) => setBrowserManagers(result.browsers || []))
      .catch(() => setBrowserManagers([]));
  };

  const manageBrowser = async (browser: BrowserManager, action: 'install' | 'uninstall') => {
    const busyKey = `${browser.id}:${action}`;
    setBrowserBusy(busyKey);
    setBrowserError('');
    setBrowserNotice('');
    try {
      await invoke('codeclub_browser_extension_manage', { browser: browser.id, action });
      setBrowserNotice(action === 'install'
        ? (language === 'en' ? `Choose “Load unpacked” in ${browser.name}, then select the opened Codeclub Browser Control folder.` : `En ${browser.name}, elegí «Cargar descomprimida» y seleccioná la carpeta Codeclub Browser Control que se abrió.`)
        : (language === 'en' ? `Remove Codeclub Browser Control from the extensions page in ${browser.name}.` : `Confirmá «Quitar» Codeclub Browser Control en la página de extensiones de ${browser.name}.`));
      refreshBrowserManagers();
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : (language === 'en' ? 'Could not open browser extension settings.' : 'No se pudo abrir la configuración de extensiones.'));
    } finally {
      setBrowserBusy('');
    }
  };

  useEffect(() => {
    refresh();
    refreshBrowserManagers();
    const browserRefresh = window.setInterval(refreshBrowserManagers, 3000);
    const events = ['codeclub:extensions-changed', 'codeclub:skills-changed', 'codeclub:mcp-changed'];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => { window.clearInterval(browserRefresh); events.forEach((event) => window.removeEventListener(event, refresh)); };
  }, [projectPath]);

  useEffect(() => {
    const root = document.getElementById('codeclub-extensions-panel');
    const tablist = root?.querySelector('nav');
    if (!root || !tablist) return;
    const ids = ['extensions', 'skills', 'mcp'] as const;
    const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button'));
    tablist.setAttribute('role', 'tablist');
    tabs.forEach((button, index) => {
      const id = ids[index];
      if (!id) return;
      const selected = tab === id;
      button.id = `extensions-tab-${id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('aria-controls', `extensions-panel-${id}`);
      button.tabIndex = selected ? 0 : -1;
      button.onkeydown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const currentIndex = ids.indexOf(id);
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        setTab(ids[nextIndex]);
        tabs[nextIndex]?.focus();
      };
    });
    const panel = root.querySelector('section');
    if (panel) {
      panel.id = `extensions-panel-${tab}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `extensions-tab-${tab}`);
      panel.tabIndex = 0;
    }
    return () => tabs.forEach((button) => { button.onkeydown = null; });
  }, [tab]);


  return (
    <section id="codeclub-extensions-panel" aria-labelledby="codeclub-extensions-heading" className="extensions-panel-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-(--codeclub-center)">
      <div className="extensions-panel-content mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7">
        <header>
          <h1 id="codeclub-extensions-heading" className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h1>
          <p className="mt-1.5 text-[14px] text-[#999999]">{text.description}</p>
          {projectPath && <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-[#777777]" title={projectPath}><Folder size={13} className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{text.project}: {projectPath.split(/[\\/]/).pop()}</span></p>}
        </header>

        <div className="extensions-toolbar mt-8 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-0.5 text-[13px] text-[#777777]" aria-label={text.categories}>
            {([{ id: 'extensions', label: text.extensions, count: allExtensions.length, icon: Blocks }, { id: 'skills', label: text.skills, count: skills.length, icon: WandSparkles }, { id: 'mcp', label: 'MCP', count: mcpServers.length, icon: PlugZap }] as const).map(({ id, label, count, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-label={`${label} ${count}`} title={`${label} ${count}`} className={`extensions-category inline-flex items-center gap-1.5 rounded-[8px] border-0 px-3 py-1.5 ${tab === id ? 'bg-[#2b2b2b] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#202020]'}`}><Icon size={14} strokeWidth={1.8} className="shrink-0 text-[#eeeeee]" aria-hidden="true" /><span className="extensions-category-label">{label}</span> <span className="text-[#999999]">{count}</span></button>)}
          </nav>
          <label className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-full border border-[#4a4a4a] bg-[#2b2b2b] px-3.5 text-[#a7a7a7] focus-within:border-[#666666]"><Search size={17} strokeWidth={1.7} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === 'en' ? 'Search extensions' : 'Buscar complementos'} aria-label={language === 'en' ? 'Search extensions' : 'Buscar complementos'} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#d0d0d0] outline-none placeholder:text-[#a7a7a7]" /></label>
        </div>

        {tab === 'extensions' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label={text.list}>
          {filteredExtensions.map(({ id, name, description, icon: Icon = Box, color, scope, protected: isProtected, builtIn }) => {
            const enabledKey = isProtected ? id : name;
            const isEnabled = enabled[enabledKey] ?? true;
            if (id === 'browser-control') return <div key={id} className="min-w-0 rounded-lg px-3 py-3 transition-colors hover:bg-[#202020]">
              <div className="flex min-h-[44px] min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><div className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#1687FF]"><Globe size={17} strokeWidth={1.8} className="text-white" /></div></div>
                <div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">Codeclub Browser Control</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{language === 'en' ? 'Control tabs in Chromium-based browsers' : 'Controlá pestañas en navegadores basados en Chromium'}</p></div>
                <span className="extensions-scope shrink-0 rounded-full border border-[#303030] px-2 py-1 text-[10px] text-[#8f8f8f]">{scopeLabel('global', language)}</span>
              </div>
              <div className="extensions-browser-managers mt-2 grid min-w-0 gap-1.5 pl-[52px]">
                {browserManagers.filter((browser) => browser.installed).map((browser) => <div key={browser.id} className="extensions-browser-row grid min-h-10 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[#252525]">
                  <div className="min-w-0 flex-1"><p className="m-0 truncate text-[13px] text-[#d5d5d5]">{browser.name}</p><p className="m-0 text-[11px] text-[#888888]">{browser.connected ? (language === 'en' ? 'Connected' : 'Conectado') : (language === 'en' ? 'Not connected' : 'Sin conectar')}</p></div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" disabled={Boolean(browserBusy)} onClick={() => void manageBrowser(browser, 'install')} aria-label={`${actions.install}: ${browser.name}`} title={`${actions.install}: ${browser.name}`} className="extensions-browser-action inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[#383838] bg-[#252525] px-2.5 text-[11px] text-[#d5d5d5] hover:bg-[#303030] disabled:opacity-50"><Download size={13} className="shrink-0" aria-hidden="true" /><span>{actions.install}</span></button>
                    <button type="button" disabled={Boolean(browserBusy)} onClick={() => void manageBrowser(browser, 'uninstall')} aria-label={`${actions.uninstall}: ${browser.name}`} title={`${actions.uninstall}: ${browser.name}`} className="extensions-browser-action inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[#383838] bg-transparent px-2.5 text-[11px] text-[#999999] hover:bg-[#303030] hover:text-[#d5d5d5] disabled:opacity-50"><Trash2 size={13} className="shrink-0" aria-hidden="true" /><span>{actions.uninstall}</span></button>
                  </div>
                </div>)}
                {browserManagers.filter((browser) => browser.installed).length === 0 && <p className="m-0 py-2 text-[12px] text-[#888888]">{language === 'en' ? 'No supported browser was detected. Supports Edge, Chrome, Brave, Opera, and Vivaldi.' : 'No se detectó un navegador compatible. Compatible con Edge, Chrome, Brave, Opera y Vivaldi.'}</p>}
                <p className="m-0 pt-1 text-[11px] leading-5 text-[#777777]">{language === 'en' ? 'Install opens the browser’s extension page and the extension folder. The browser requires you to load it and approve its permissions. Uninstall opens the page so you can confirm removal.' : 'Instalar abre la página de extensiones y la carpeta. El navegador requiere que la cargues y aceptes sus permisos. Desinstalar abre esa página para que confirmes la eliminación.'}</p>
                {browserNotice && <p role="status" className="m-0 text-[11px] leading-5 text-[#8bc7ff]">{browserNotice}</p>}
                {browserError && <p role="alert" className="m-0 text-[11px] leading-5 text-[#ff8a8a]">{browserError}</p>}
              </div>
            </div>;
            return <div key={id} className="extensions-item flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><div className="grid h-7 w-7 place-items-center rounded-[7px]" style={{ background: color }}><Icon size={17} strokeWidth={1.8} className="text-white" /></div></div>
              <div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{description}</p></div>
              <span className="extensions-scope shrink-0 rounded-full border border-[#303030] px-2 py-1 text-[10px] text-[#8f8f8f]">{scopeLabel(scope, language)}</span>
              {builtIn ? <span className="extensions-included shrink-0 rounded-full border border-[#303030] px-2 py-1 text-[10px] text-[#8f8f8f]">{language === 'en' ? 'Built in' : 'Incluido'}</span> : <button type="button" role="switch" aria-checked={isEnabled} aria-label={`${isEnabled ? text.disable : text.enable} ${name}`} onClick={() => { const next = !isEnabled; setEnabled((current) => ({ ...current, [enabledKey]: next })); if (isProtected) void setSetting(`codeclub_extension_enabled_${id}`, String(next)); }} className={`relative h-6 w-10 shrink-0 rounded-full border-0 transition-colors ${isEnabled ? 'bg-[#3d9bff]' : 'bg-[#3a3a3a]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isEnabled ? 'right-1' : 'left-1'}`} /></button>}
              {!isProtected && <button type="button" onClick={() => { void invoke('codeclub_delete_agent_plugin', { projectPath, pluginId: id.replace(/^plugin:/, ''), scope }).then(refresh).catch(() => undefined); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777777] hover:bg-[#2b2b2b] hover:text-[#eeeeee]" title={text.deletePlugin} aria-label={`${text.deletePlugin}: ${name}`}><Trash2 size={14} /></button>}
            </div>;
          })}
          {filteredExtensions.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.empty}</div>}
        </section>}
        {tab === 'skills' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label={text.skillsList}>
          {filteredSkills.map((skill) => <div key={`${skill.source}-${skill.id}`} className="extensions-item flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><WandSparkles size={19} strokeWidth={1.7} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{skill.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{skill.description}</p></div><span className="extensions-source min-w-0 max-w-[160px] truncate text-[11px] text-[#777777]" title={`${skill.source} · ${scopeLabel(skill.scope, language)}`}>{skill.source} · {scopeLabel(skill.scope, language)}</span></div>)}
          {filteredSkills.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.noSkills}</div>}
        </section>}
        {tab === 'mcp' && <section className="mt-9 grid min-w-0 gap-1.5" aria-label={text.mcpList}>
          {mcpServers.map((server) => <div key={server.id} className="extensions-item flex min-h-[60px] min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors hover:bg-[#202020]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#2d2d2d] bg-[#151515]"><PlugZap size={19} className="text-[#8bc7ff]" /></div><div className="min-w-0 w-0 flex-1"><h2 className="m-0 truncate text-[14px] font-semibold text-[#eeeeee]">{server.name}</h2><p className="mt-0.5 truncate text-[13px] text-[#888888]">{server.url}</p></div><span className="extensions-scope shrink-0 text-[11px] text-[#777777]">{scopeLabel(server.scope, language)}</span></div>)}
          {mcpServers.length === 0 && <div className="py-12 text-center text-sm text-[#777777]">{text.noMcp}</div>}
        </section>}
      </div>
    </section>
  );
}
