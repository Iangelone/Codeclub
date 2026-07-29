import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, ChevronDown, MapPin, Mail, Settings2, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readBusinessWorkspace, readProjectIndex, type BusinessWorkspace, type ProjectEntry, writeBusinessWorkspace } from "../lib/projectManager";
import { readGenerationUsage, summarizeGenerationUsage, type GenerationUsageRecord } from "../lib/usage";

const chartTooltip = { backgroundColor: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, color: "#ddd", fontSize: 11 };
const chartGrid = "#242424";
const colors = ["#c7cbff", "#86efac", "#fde68a", "#f9a8d4"];
const dashboardPanels = [
  { id: "financial", label: "Economía" },
  { id: "ai", label: "Actividad IA" },
  { id: "activity", label: "Actividad comercial" },
  { id: "distribution", label: "Estados" },
  { id: "software", label: "Software producido" },
  { id: "impact", label: "Impacto" },
  { id: "health", label: "Salud" },
  { id: "objective", label: "Objetivo" },
];


export default function BusinessPanel() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [business, setBusiness] = useState<Record<string, BusinessWorkspace | null>>({});
  const [usage, setUsage] = useState<Record<string, GenerationUsageRecord[]>>({});
  const [selectedProjectPath, setSelectedProjectPath] = useState("*");
  const [usageFrom, setUsageFrom] = useState("");
  const [usageTo, setUsageTo] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => { const nextProjects = await readProjectIndex(); setProjects(nextProjects); const entries = await Promise.all(nextProjects.map(async (project) => [project.path, await readBusinessWorkspace(project.path)] as const)); const usageEntries = await Promise.all(nextProjects.map(async (project) => [project.path, await readGenerationUsage(project.path)] as const)); setBusiness(Object.fromEntries(entries)); setUsage(Object.fromEntries(usageEntries)); setLoading(false); };
    void load();
    window.addEventListener("codeclub:project-indexed", load);
    window.addEventListener("codeclub:business-updated", load);
    window.addEventListener("codeclub:usage-updated", load);
    return () => { window.removeEventListener("codeclub:project-indexed", load); window.removeEventListener("codeclub:business-updated", load); window.removeEventListener("codeclub:usage-updated", load); };
  }, []);

  const visibleProjects = selectedProjectPath === "*" ? projects : projects.filter((project) => project.path === selectedProjectPath);
  const visibleBusiness = visibleProjects.map((project) => business[project.path]).filter(Boolean) as BusinessWorkspace[];
  const visiblePanels = selectedProjectPath === "*"
    ? Object.fromEntries(dashboardPanels.map((panel) => [panel.id, visibleBusiness.length > 0 && visibleBusiness.every((item) => item.dashboard?.visible_panels?.[panel.id] !== false)]))
    : business[selectedProjectPath]?.dashboard?.visible_panels || {};
  const panelTypes = selectedProjectPath === "*" ? {} : business[selectedProjectPath]?.dashboard?.panel_types || {};
  const cardVariant = (id: string, fallback: "metric" | "progress" | "trend" | "status") => ["metric", "progress", "trend", "status"].includes(panelTypes[id]) ? panelTypes[id] as "metric" | "progress" | "trend" | "status" : fallback;
  const isPanelVisible = (id: string) => visiblePanels[id] !== false;
  const togglePanel = async (id: string) => {
    const nextVisible = !isPanelVisible(id);
    await Promise.all(visibleProjects.map(async (project) => {
      const workspace = business[project.path];
      if (!workspace) return;
      await writeBusinessWorkspace(project.path, { ...workspace, dashboard: { ...workspace.dashboard, visible_panels: { ...(workspace.dashboard?.visible_panels || {}), [id]: nextVisible } } });
    }));
  };
  const visibleUsage = visibleProjects.flatMap((project) => usage[project.path] || []);
  const usageSummary = summarizeGenerationUsage(visibleUsage, usageFrom || undefined, usageTo || undefined);
  const totalFiles = visibleProjects.reduce((sum, project) => sum + (project.file_count || 0), 0);
  const totalRevenue = visibleBusiness.flatMap((item) => item.invoices).reduce((sum, item: any) => sum + Number(item.amount || item.total || 0), 0);
  const totalExpenses = visibleBusiness.flatMap((item) => item.expenses).reduce((sum, item: any) => sum + Number(item.amount || 0), 0);
  const totalEstimatedValue = visibleBusiness.reduce((sum, item) => sum + Number(item.project.estimated_value || 0), 0);
  const totalContractedValue = visibleBusiness.reduce((sum, item) => sum + Number(item.project.contracted_value || 0), 0);
  const totalQuotedValue = visibleBusiness.flatMap((item) => item.quotes).reduce((sum, quote: any) => sum + Number(quote.total || 0), 0);
  const acceptedQuotedValue = visibleBusiness.flatMap((item) => item.quotes).filter((quote: any) => quote.status === "accepted").reduce((sum, quote: any) => sum + Number(quote.total || 0), 0);
  const pipelineValue = visibleBusiness.flatMap((item) => item.quotes).filter((quote: any) => ["draft", "sent"].includes(String(quote.status || "draft"))).reduce((sum, quote: any) => sum + Number(quote.total || 0), 0);
  const monthlyFees = visibleBusiness.reduce((sum, item) => sum + Number(item.project.monthly_fee || item.pricing.retainer_monthly || 0), 0);
  const quoteCount = visibleBusiness.reduce((sum, item) => sum + item.quotes.length, 0);
  const projectBars = visibleProjects.slice().sort((a, b) => (b.file_count || 0) - (a.file_count || 0)).slice(0, 6).map((project) => ({ name: project.name.slice(0, 12), files: project.file_count || 0 }));
  const activity = useMemo(() => buildMonthlyActivity(visibleBusiness), [visibleBusiness]);
  const statusData = buildStatusData(visibleProjects, business);
  const totalMilestones = visibleBusiness.reduce((sum, item) => sum + item.milestones.length, 0);
  const completedMilestones = visibleBusiness.reduce((sum, item) => sum + item.milestones.filter((milestone: any) => ["completed", "completado", "done"].includes(String(milestone.status).toLowerCase())).length, 0);
  const totalOutcomes = visibleBusiness.reduce((sum, item) => sum + (item.outcomes || []).length, 0);
  const completedOutcomes = visibleBusiness.reduce((sum, item) => sum + (item.outcomes || []).filter((outcome: any) => ["completed", "completado", "done"].includes(String(outcome.status).toLowerCase())).length, 0);
  const totalResults = totalOutcomes || totalMilestones;
  const completedResults = totalOutcomes ? completedOutcomes : completedMilestones;
  const impactProgress = percent(completedResults, totalResults);
  const projectsWithData = visibleBusiness.length;
  const radarData = [{ subject: "Cotización", value: percent(visibleBusiness.reduce((sum, item) => sum + item.quotes.length, 0), Math.max(1, visibleProjects.length)) }, { subject: "Resultados", value: impactProgress }, { subject: "Margen", value: percent(totalRevenue - totalExpenses, totalRevenue) }, { subject: "Impacto", value: percent(visibleBusiness.filter((item) => item.pricing.expected_impact).length, Math.max(1, visibleProjects.length)) }, { subject: "Datos", value: percent(projectsWithData, visibleProjects.length) }];
  const radialData = [{ name: "Resultados", value: impactProgress, fill: "#c7cbff" }];
  const netResult = totalRevenue - totalExpenses;

  if (loading) return <div className="h-full w-full overflow-auto p-6"><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-[#161616]" />)}</div><div className="mt-3 h-72 animate-pulse rounded-xl bg-[#161616]" /></div>;

  return <div className="business-dashboard-scrollbar absolute inset-0 overflow-auto overscroll-contain p-5 md:p-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="hidden"><div>Negocios</div></div>

      <div className="relative"><div className="absolute right-5 top-5 z-10 flex items-center gap-2"><DashboardPanelMenu visiblePanels={visiblePanels} onToggle={togglePanel} disabled={selectedProjectPath === "*" && visibleBusiness.length === 0} /><ProjectFilterMenu projects={projects} selectedProjectPath={selectedProjectPath} onProjectChange={setSelectedProjectPath} /></div><DeveloperCard projects={projects} selectedProjectPath={selectedProjectPath} onProjectChange={setSelectedProjectPath} /></div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#202020] p-3 text-[11px] text-[#777]">
        <span>Período IA</span>
        <input type="date" value={usageFrom} onChange={(event) => setUsageFrom(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[#ccc]" aria-label="Desde" />
        <span>—</span>
        <input type="date" value={usageTo} onChange={(event) => setUsageTo(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[#ccc]" aria-label="Hasta" />
        {(usageFrom || usageTo) && <button type="button" onClick={() => { setUsageFrom(""); setUsageTo(""); }} className="rounded-lg px-2 py-1.5 text-[#aaa] hover:bg-[#1c1c1c]">Limpiar</button>}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("revenue", "metric")} title="Ingresos" subtitle="Facturas y cobros registrados" label="Total" value={formatMoney(totalRevenue)} detail="Cobrado" />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("estimatedValue", "progress")} title="Valor estimado" subtitle="Valor potencial guardado por proyecto" label="Total" value={formatMoney(totalEstimatedValue)} progress={percent(totalEstimatedValue, Math.max(totalEstimatedValue, totalQuotedValue))} detail="Estimación" />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("contractedValue", "status")} title="Valor contratado" subtitle="Cotizaciones aceptadas / contratos" label="Total" value={formatMoney(totalContractedValue || acceptedQuotedValue)} detail={acceptedQuotedValue > 0 ? "Aceptado" : "Sin contrato"} />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("expenses", "metric")} title="Gastos" subtitle="Costos cargados en proyectos" label="Total" value={formatMoney(totalExpenses)} detail="Costo" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("quotedValue", "metric")} title="Total cotizado" subtitle="Todas las propuestas creadas" label="Portfolio" value={formatMoney(totalQuotedValue)} detail={`${quoteCount} propuestas`} />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("pipeline", "progress")} title="Pipeline" subtitle="Borradores y propuestas enviadas" label="Activo" value={formatMoney(pipelineValue)} progress={percent(pipelineValue, Math.max(pipelineValue, totalQuotedValue))} detail="En curso" />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("results", "progress")} title="Resultados entregados" subtitle="Software y objetivos completados" label="Total" value={`${completedResults}/${totalResults}`} progress={impactProgress} detail="Completado" />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("margin", "trend")} title="Margen" subtitle="Resultado neto sobre ingresos" label="Neto" value={formatMoney(netResult)} detail={totalRevenue > 0 ? `${percent(netResult, totalRevenue)}% sobre ingresos` : "Sin ingresos"} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("ai")} variant={cardVariant("generations", "metric")} title="Generaciones IA" subtitle="Outputs producidos" label="Ejecuciones" value={String(usageSummary.generations)} detail="Actividad" />
        <DashboardCard visible={isPanelVisible("ai")} variant={cardVariant("tokens", "trend")} title="Tokens" subtitle="Entrada + salida" label="Total" value={formatCompact(usageSummary.totalTokens)} detail="Consumo interno" />
        <DashboardCard visible={isPanelVisible("ai")} variant={cardVariant("aiCost", "status")} title="Costo IA estimado" subtitle="Costo interno del modelo" label="USD" value={formatMoney(usageSummary.estimatedCost)} detail="No es precio al cliente" />
        <DashboardCard visible={isPanelVisible("financial")} variant={cardVariant("retainer", "status")} title="Abonos de valor" subtitle={`${quoteCount} cotización${quoteCount === 1 ? "" : "es"}`} label="Mensual" value={formatMoney(monthlyFees)} detail="Recurrente" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <Panel visible={isPanelVisible("activity")} title="Actividad registrada" subtitle="Cotizaciones y movimientos reales"><ResponsiveContainer width="100%" height={260}><AreaChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="businessGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c7cbff" stopOpacity={0.3} /><stop offset="100%" stopColor="#c7cbff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Area type="monotone" dataKey="quotes" stroke="#c7cbff" strokeWidth={2} fill="url(#businessGradient)" /><Area type="monotone" dataKey="movements" stroke="#86efac" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("distribution")} title="Distribución" subtitle="Estado actual de los negocios"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none">{statusData.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}</Pie><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="22" fontWeight="600">{projects.length}</text><text x="50%" y="57%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">total</text></PieChart></ResponsiveContainer><div className="grid grid-cols-2 gap-2 px-2 pb-1">{statusData.map((status, index) => <div key={status.name} className="flex items-center gap-2 text-[10px] text-[#777]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index] }} />{status.name}</div>)}</div></Panel>
      </div>

      <Panel visible={isPanelVisible("ai")} title="Actividad de IA por proyecto" subtitle="Generaciones, tokens y costo interno"><ResponsiveContainer width="100%" height={240}><LineChart data={buildUsageActivity(usageSummary.records)} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis yAxisId="right" orientation="right" tick={{ fill: "#666", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={chartTooltip} /><Line yAxisId="left" type="monotone" dataKey="generations" stroke="#c7cbff" strokeWidth={2} dot={{ fill: "#c7cbff", r: 3 }} /><Line yAxisId="left" type="monotone" dataKey="tokens" stroke="#86efac" strokeWidth={2} dot={{ fill: "#86efac", r: 3 }} /><Line yAxisId="right" type="monotone" dataKey="cost" stroke="#fde68a" strokeWidth={2} dot={{ fill: "#fde68a", r: 3 }} /></LineChart></ResponsiveContainer></Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel visible={isPanelVisible("software")} title="Software producido" subtitle="Contenido indexado por proyecto"><ResponsiveContainer width="100%" height={220}><BarChart data={projectBars} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Bar dataKey="files" fill="#c7cbff" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("impact")} title="Progreso de impacto" subtitle="Resultados verificables del portfolio"><div className="space-y-4 pt-4"><ProgressRow label="Resultados completados" value={impactProgress} color="#86efac" /><ProgressRow label="Proyectos con impacto definido" value={percent(visibleBusiness.filter((item) => item.pricing.expected_impact).length, Math.max(1, visibleProjects.length))} color="#fde68a" /></div></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel visible={isPanelVisible("health")} title="Salud del negocio" subtitle="Radar de indicadores clave"><ResponsiveContainer width="100%" height={250}><RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%"><PolarGrid stroke="#2b2b2b" /><PolarAngleAxis dataKey="subject" tick={{ fill: "#777", fontSize: 10 }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Valor" dataKey="value" stroke="#c7cbff" fill="#c7cbff" fillOpacity={0.22} /></RadarChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("objective")} title="Objetivo del período" subtitle="Progreso radial"><ResponsiveContainer width="100%" height={250}><RadialBarChart cx="50%" cy="50%" innerRadius="68%" outerRadius="92%" barSize={14} startAngle={90} endAngle={-270} data={radialData}><RadialBar background={{ fill: "#202020" }} dataKey="value" cornerRadius={10} /><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="28" fontWeight="600">{radialData[0].value}%</text><text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">completado</text></RadialBarChart></ResponsiveContainer></Panel>
      </div>

      <div className="hidden">
        <Panel title="Progreso general" subtitle="Objetivos del período"><ProgressRow label="Proyectos indexados" value={Math.min(100, projects.length * 12)} color="#c7cbff" /><ProgressRow label="Archivos organizados" value={Math.min(100, Math.round(totalFiles / 2))} color="#86efac" /><ProgressRow label="Entregas completadas" value={Math.min(100, projects.length * 18)} color="#fde68a" /></Panel>
        <Panel title="Actividad reciente" subtitle="Últimos movimientos"><div className="space-y-4 pt-3">{["Proyecto actualizado", "Archivos indexados", "Nuevo negocio creado"].map((item, index) => <div key={item} className="flex items-center gap-3"><div className="grid h-7 w-7 place-items-center rounded-lg bg-[#1c1c1c] text-[#777]"><CheckCircle2 size={14} /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-[#bbb]">{item}</div><div className="text-[10px] text-[#555]">Hace {index + 1} momentos</div></div></div>)}</div></Panel>
        <Panel title="Tendencia" subtitle="Crecimiento promedio"><div className="flex h-full min-h-[150px] flex-col justify-between pt-4"><div className="flex items-end gap-2"><TrendingUp size={18} className="mb-1 text-[#86efac]" /><span className="text-3xl font-semibold tracking-tight text-[#eee]">+18.4%</span></div><div className="flex items-center gap-1 text-[11px] text-[#666]"><ArrowUpRight size={13} className="text-[#86efac]" /> 6.2% más que el período anterior</div></div></Panel>
      </div>
    </div>
  </div>;
}

function ProjectFilterMenu({ projects, selectedProjectPath, onProjectChange }: { projects: ProjectEntry[]; selectedProjectPath: string; onProjectChange: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.path === selectedProjectPath);
  useEffect(() => { if (!open) return; const handlePointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", handlePointerDown); return () => document.removeEventListener("pointerdown", handlePointerDown); }, [open]);
  return <div ref={menuRef} className="relative"><button type="button" onClick={() => setOpen((value) => !value)} className="flex h-8 min-w-[170px] items-center justify-between gap-3 rounded-lg border border-[#2b2b2b] bg-[#161616] px-2.5 text-left text-[11px] text-[#ddd] hover:bg-[#1c1c1c]" aria-label="Filtrar por proyecto"><span className="truncate">{selected?.name || "Todos los proyectos"}</span><ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} /></button>{open && <div className="absolute right-0 top-10 z-20 grid min-w-[210px] gap-1 rounded-xl border border-[#2b2b2b] bg-[#121212] p-1.5 shadow-xl"><button type="button" onClick={() => { onProjectChange("*"); setOpen(false); }} className="flex min-h-[32px] items-center rounded-lg px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e]">Todos los proyectos</button>{projects.map((project) => <button key={project.path} type="button" onClick={() => { onProjectChange(project.path); setOpen(false); }} className="flex min-h-[32px] items-center rounded-lg px-2.5 text-left text-xs text-[#bdbdbd] hover:bg-[#1e1e1e]"><span className="truncate">{project.name}</span></button>)}</div>}</div>;
}

function DashboardPanelMenu({ visiblePanels, onToggle, disabled }: { visiblePanels: Record<string, boolean>; onToggle: (id: string) => void | Promise<void>; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const handlePointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", handlePointerDown); return () => document.removeEventListener("pointerdown", handlePointerDown); }, [open]);
  return <div ref={menuRef} className="relative"><button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#2b2b2b] bg-[#161616] text-[#aaa] hover:bg-[#1c1c1c] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Configurar paneles" title="Mostrar u ocultar paneles"><Settings2 size={14} /></button>{open && <div className="absolute right-0 top-10 z-20 min-w-[190px] rounded-xl border border-[#2b2b2b] bg-[#121212] p-2 shadow-xl"><div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.08em] text-[#666]">Paneles visibles</div>{dashboardPanels.map((panel) => <label key={panel.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-[#bbb] hover:bg-[#1e1e1e]"><input type="checkbox" checked={visiblePanels[panel.id] !== false} onChange={() => void onToggle(panel.id)} className="accent-[#c7cbff]" />{panel.label}</label>)}</div>}</div>;
}

function DeveloperCard({ projects, selectedProjectPath, onProjectChange }: { projects: ProjectEntry[]; selectedProjectPath: string; onProjectChange: (path: string) => void }) {
  const changes = [
    { title: "Proyecto indexado", detail: "Codeclub Desktop", time: "Hace 12 min", color: "#c7cbff" },
    { title: "Archivos actualizados", detail: "src/components", time: "Hace 28 min", color: "#86efac" },
    { title: "Entrega completada", detail: "Dashboard de Negocios", time: "Hace 1 h", color: "#fde68a" },
    { title: "Chat iniciado", detail: "Sin proyecto", time: "Hace 2 h", color: "#f9a8d4" },
  ];
  return <section className="rounded-xl border border-[#202020] p-5"><div className="flex flex-col gap-5 md:flex-row md:items-center"><div className="flex items-center gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#c7cbff] text-xl font-semibold text-[#1a1a1a]">IG</div><div><div className="text-lg font-medium text-[#eee]">Iange</div><div className="mt-1 text-xs text-[#777]">Desarrollador full-stack · Codeclub</div><div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[#666]"><span className="flex items-center gap-1"><MapPin size={12} /> Buenos Aires</span><span className="flex items-center gap-1"><Mail size={12} /> iange@codeclub.dev</span></div></div></div></div><div className="mt-5 border-t border-[#202020] pt-4"><div className="business-history-ribbon overflow-hidden"><div className="business-history-track flex w-max gap-2">{[...changes, ...changes].map((change, index) => <div key={`${change.title}-${index}`} className="w-[170px] shrink-0 rounded-lg border border-[#202020] p-2.5"><div className="mb-2 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: change.color }} /><div className="truncate text-[10px] font-medium text-[#ccc]">{change.title}</div><div className="mt-1 truncate text-[9px] text-[#777]">{change.detail}</div><div className="mt-2 text-[9px] text-[#555]">{change.time}</div></div>)}</div></div></div></section>;
}

function DashboardCard({ title, subtitle, label, value, detail, progress = 0, variant, visible = true }: { title: string; subtitle: string; label: string; value: string; detail: string; progress?: number; variant: "metric" | "progress" | "trend" | "status"; visible?: boolean }) {
  if (!visible) return null;
  return <section className="rounded-xl border border-[#202020] bg-[#151515] p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-medium text-[#ddd]">{title}</div><div className="mt-1 text-[10px] text-[#666]">{subtitle}</div></div><span className={`rounded-md px-1.5 py-1 text-[9px] uppercase tracking-[0.08em] ${variant === "status" ? "bg-[#1c2a22] text-[#86efac]" : variant === "trend" ? "bg-[#24223a] text-[#c7cbff]" : "bg-[#1c1c1c] text-[#777]"}`}>{variant}</span></div><div className="mt-4"><div className="text-[10px] text-[#666]">{label}</div><div className="mt-1 text-2xl font-medium tracking-tight text-[#eee]">{value}</div>{variant === "progress" && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-[#202020]"><div className="h-full rounded-full bg-[#86efac] transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div><div className="mt-1 text-[10px] text-[#777]">{Math.round(progress)}% del objetivo</div></div>}{variant === "trend" && <div className="mt-2 flex items-center gap-1 text-[10px] text-[#c7cbff]"><ArrowUpRight size={12} />Indicador de tendencia</div>}{variant === "status" && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#86efac]"><span className="h-1.5 w-1.5 rounded-full bg-[#86efac]" />Estado actual</div>}<div className="mt-2 text-[10px] text-[#666]">{detail}</div></div></section>;
}

function Panel({ title, subtitle, children, visible = true }: { title: string; subtitle: string; children: React.ReactNode; visible?: boolean }) {
  if (!visible) return null;
  return <section className="rounded-xl border border-[#202020] p-4"><div className="mb-3"><div className="text-xs font-medium text-[#ddd]">{title}</div><div className="mt-1 text-[10px] text-[#666]">{subtitle}</div></div>{children}</section>;
}

function ProgressRow({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="mb-4"><div className="mb-1.5 flex justify-between text-[10px] text-[#777]"><span>{label}</span><span>{value}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#202020]"><div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} /></div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] text-[#666]">{label}</div><div className="mt-1 text-2xl font-medium tracking-tight text-[#eee]">{value}</div></div>;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function buildStatusData(projects: ProjectEntry[], business: Record<string, BusinessWorkspace | null>) {
  const statuses = new Map<string, number>();
  projects.forEach((project) => { const status = business[project.path]?.project.status || "sin datos"; statuses.set(status, (statuses.get(status) || 0) + 1); });
  return [...statuses.entries()].map(([name, value]) => ({ name, value }));
}

function buildMonthlyActivity(items: BusinessWorkspace[]) {
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() - (5 - index)); return { key: `${date.getFullYear()}-${date.getMonth()}`, month: date.toLocaleDateString("es-AR", { month: "short" }), quotes: 0, movements: 0 }; });
  const byKey = new Map(months.map((item) => [item.key, item]));
  const add = (entries: any[], kind: "quotes" | "movements") => entries.forEach((entry) => { const rawDate = entry.date || entry.created_at || entry.updated_at || entry.issued_at; if (!rawDate) return; const date = new Date(rawDate); if (Number.isNaN(date.getTime())) return; const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`); if (!bucket) return; bucket[kind] += 1; });
  items.forEach((item) => { add(item.quotes, "quotes"); add(item.invoices, "movements"); add(item.expenses, "movements"); add(item.payments, "movements"); });
  return months;
}

function Record({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between text-[11px]"><span className="text-[#777]">{label}</span><span className="text-[#ddd]">{value}</span></div>;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(durationMs: number) {
  const seconds = durationMs / 1000;
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)} min` : `${seconds.toFixed(1)} s`;
}

function buildUsageActivity(records: GenerationUsageRecord[]) {
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() - (5 - index)); return { key: `${date.getFullYear()}-${date.getMonth()}`, month: date.toLocaleDateString("es-AR", { month: "short" }), generations: 0, tokens: 0, cost: 0 }; });
  const byKey = new Map(months.map((item) => [item.key, item]));
  records.forEach((record) => { const date = new Date(record.at); const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`); if (!bucket) return; bucket.generations += 1; bucket.tokens += Number(record.totalTokens || 0); bucket.cost += (Number(record.inputTokens || 0) / 1_000_000) * Number(record.inputCostPerMillion || 0) + (Number(record.outputTokens || 0) / 1_000_000) * Number(record.outputCostPerMillion || 0); });
  return months;
}
