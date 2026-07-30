import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Activity, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, MapPin, Mail, Settings2, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readBusinessWorkspace, readProjectIndex, type BusinessWorkspace, type ProjectEntry, writeBusinessWorkspace } from "../lib/projectManager";
import { readExecutionLog, type ExecutionLogRecord } from "../lib/execution-log";
import { readGenerationUsage, summarizeGenerationUsage, type GenerationUsageRecord } from "../lib/usage";
import { BUSINESS_COLORS, BUSINESS_TOKENS } from "../lib/business-tokens";

const chartTooltip = { backgroundColor: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, color: "#ddd", fontSize: 11 };
const chartGrid = "#242424";
const colors = BUSINESS_COLORS;
const dashboardPanels = [
  { id: "financial", label: "Economía" },
  { id: "ai", label: "Actividad IA" },
  { id: "activity", label: "Actividad comercial" },
  { id: "funnel", label: "Embudo comercial" },
  { id: "distribution", label: "Estados" },
  { id: "software", label: "Software producido" },
  { id: "projectValue", label: "Valor por proyecto" },
  { id: "pipelineChart", label: "Pipeline por estado" },
  { id: "aiProjects", label: "IA por proyecto" },
  { id: "portfolio", label: "Portfolio" },
  { id: "impact", label: "Impacto" },
  { id: "health", label: "Salud" },
  { id: "objective", label: "Objetivo" },
];
type ActivityCard = { id: string; title: string; detail: string; time: string; color: string; at: number };


export default function BusinessPanel() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [business, setBusiness] = useState<Record<string, BusinessWorkspace | null>>({});
  const [usage, setUsage] = useState<Record<string, GenerationUsageRecord[]>>({});
  const [activityHistory, setActivityHistory] = useState<ActivityCard[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState("*");
  const [usageFrom, setUsageFrom] = useState("");
  const [usageTo, setUsageTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [metricGroupsOpen, setMetricGroupsOpen] = useState({ financial: true, ai: true });

  useEffect(() => {
    const load = async () => { const nextProjects = await readProjectIndex(); setProjects(nextProjects); const entries = await Promise.all(nextProjects.map(async (project) => [project.path, await readBusinessWorkspace(project.path)] as const)); const usageEntries = await Promise.all(nextProjects.map(async (project) => [project.path, await readGenerationUsage(project.path)] as const)); const executionEntries = await Promise.all([...nextProjects.map((project) => readExecutionLog(project.path, 80)), readExecutionLog("", 80)]); const nextBusiness = Object.fromEntries(entries); const nextUsage = Object.fromEntries(usageEntries); setBusiness(nextBusiness); setUsage(nextUsage); setActivityHistory(buildActivityHistory(nextProjects, executionEntries.flat(), Object.values(nextUsage).flat())); setLoading(false); };
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
  const projectValueBars = buildProjectValueBars(visibleProjects, business);
  const pipelineBars = buildPipelineBars(visibleProjects, business);
  const aiProjectBars = buildAiProjectBars(visibleProjects, usage);
  const portfolioRows = buildPortfolioRows(visibleProjects, business);
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
  const radialData = [{ name: "Resultados", value: impactProgress, fill: BUSINESS_TOKENS.electricBlue }];
  const netResult = totalRevenue - totalExpenses;

  if (loading) return <div className="h-full w-full overflow-auto p-6"><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-[#161616]" />)}</div><div className="mt-3 h-72 animate-pulse rounded-xl bg-[#161616]" /></div>;

  return <div className="business-dashboard-scrollbar absolute inset-0 overflow-auto overscroll-contain p-5 md:p-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="hidden"><div>Negocios</div></div>

      <div className="relative"><div className="absolute right-5 top-5 z-10 flex items-center gap-2"><DashboardPanelMenu visiblePanels={visiblePanels} onToggle={togglePanel} disabled={selectedProjectPath === "*" && visibleBusiness.length === 0} /><UsagePeriodMenu usageFrom={usageFrom} usageTo={usageTo} onFromChange={setUsageFrom} onToChange={setUsageTo} /><ProjectFilterMenu projects={projects} selectedProjectPath={selectedProjectPath} onProjectChange={setSelectedProjectPath} /></div><DeveloperCard events={activityHistory} /></div>

      {portfolioRows.some((row) => row.estimated > 0 && row.margin < 0 || !row.hasBusinessData) && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#FF7A45]/30 bg-[#FF7A45]/5 p-3 text-[11px] text-[#FF7A45]"><Activity size={14} className="mt-0.5 shrink-0" /><div><div className="font-medium">Revisión recomendada</div><div className="mt-0.5 text-[#b98b7d]">Hay proyectos sin datos comerciales o con margen negativo. Revisá el portfolio antes de tomar decisiones.</div></div></div>}

      <MetricAccordion title="Economía" open={metricGroupsOpen.financial} onToggle={() => setMetricGroupsOpen((current) => ({ ...current, financial: !current.financial }))}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.electricBlue} variant={cardVariant("revenue", "metric")} title="Ingresos" subtitle="Facturas y cobros registrados" label="Total" value={formatMoney(totalRevenue)} detail="Cobrado" />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.softBlue} variant={cardVariant("estimatedValue", "progress")} title="Valor estimado" subtitle="Valor potencial guardado por proyecto" label="Total" value={formatMoney(totalEstimatedValue)} progress={percent(totalEstimatedValue, Math.max(totalEstimatedValue, totalQuotedValue))} detail="Estimación" />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.lightCream} variant={cardVariant("contractedValue", "status")} title="Valor contratado" subtitle="Cotizaciones aceptadas / contratos" label="Total" value={formatMoney(totalContractedValue || acceptedQuotedValue)} detail={acceptedQuotedValue > 0 ? "Aceptado" : "Sin contrato"} />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.softPeach} variant={cardVariant("expenses", "metric")} title="Gastos" subtitle="Costos cargados en proyectos" label="Total" value={formatMoney(totalExpenses)} detail="Costo" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.warmIvory} variant={cardVariant("quotedValue", "metric")} title="Total cotizado" subtitle="Todas las propuestas creadas" label="Portfolio" value={formatMoney(totalQuotedValue)} detail={`${quoteCount} propuestas`} />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.electricOrange} variant={cardVariant("pipeline", "progress")} title="Pipeline" subtitle="Borradores y propuestas enviadas" label="Activo" value={formatMoney(pipelineValue)} progress={percent(pipelineValue, Math.max(pipelineValue, totalQuotedValue))} detail="En curso" />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.softBlue} variant={cardVariant("results", "progress")} title="Resultados entregados" subtitle="Software y objetivos completados" label="Total" value={`${completedResults}/${totalResults}`} progress={impactProgress} detail="Completado" />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.electricBlue} variant={cardVariant("margin", "trend")} title="Margen" subtitle="Resultado neto sobre ingresos" label="Neto" value={formatMoney(netResult)} detail={totalRevenue > 0 ? `${percent(netResult, totalRevenue)}% sobre ingresos` : "Sin ingresos"} />
      </div>
      </MetricAccordion>

      <MetricAccordion title="Actividad IA" open={metricGroupsOpen.ai} onToggle={() => setMetricGroupsOpen((current) => ({ ...current, ai: !current.ai }))}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <DashboardCard visible={isPanelVisible("ai")} accent={BUSINESS_TOKENS.warmIvory} variant={cardVariant("generations", "metric")} title="Generaciones IA" subtitle="Outputs producidos" label="Ejecuciones" value={String(usageSummary.generations)} detail="Actividad" />
        <DashboardCard visible={isPanelVisible("ai")} accent={BUSINESS_TOKENS.softBlue} variant={cardVariant("tokens", "trend")} title="Tokens" subtitle="Entrada + salida" label="Total" value={formatCompact(usageSummary.totalTokens)} detail="Consumo interno" />
        <DashboardCard visible={isPanelVisible("ai")} accent={BUSINESS_TOKENS.softPeach} variant={cardVariant("aiCost", "status")} title="Costo IA estimado" subtitle="Costo interno del modelo" label="USD" value={formatMoney(usageSummary.estimatedCost)} detail="No es precio al cliente" />
        <DashboardCard visible={isPanelVisible("financial")} accent={BUSINESS_TOKENS.lightCream} variant={cardVariant("retainer", "status")} title="Abonos de valor" subtitle={`${quoteCount} cotización${quoteCount === 1 ? "" : "es"}`} label="Mensual" value={formatMoney(monthlyFees)} detail="Recurrente" />
      </div>
      </MetricAccordion>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <Panel visible={isPanelVisible("funnel")} title="Embudo comercial" subtitle="De propuesta a valor contratado"><BusinessFunnel stages={[{ label: "Cotizado", value: totalQuotedValue }, { label: "Pipeline", value: pipelineValue }, { label: "Aceptado", value: acceptedQuotedValue }, { label: "Contratado", value: totalContractedValue || acceptedQuotedValue }]} /></Panel>
        <Panel visible={isPanelVisible("activity")} title="Actividad registrada" subtitle="Cotizaciones y movimientos reales"><ResponsiveContainer width="100%" height={260}><AreaChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="businessGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1687FF" stopOpacity={0.3} /><stop offset="100%" stopColor="#1687FF" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Area type="monotone" dataKey="quotes" stroke="#1687FF" strokeWidth={2} fill="url(#businessGradient)" /><Area type="monotone" dataKey="movements" stroke="#67BAFF" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("distribution")} title="Distribución" subtitle="Estado actual de los negocios"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none">{statusData.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}</Pie><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="22" fontWeight="600">{projects.length}</text><text x="50%" y="57%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">total</text></PieChart></ResponsiveContainer><div className="grid grid-cols-2 gap-2 px-2 pb-1">{statusData.map((status, index) => <div key={status.name} className="flex items-center gap-2 text-[10px] text-[#777]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index] }} />{status.name}</div>)}</div></Panel>
      </div>

      <Panel visible={isPanelVisible("ai")} title="Actividad de IA por proyecto" subtitle="Generaciones, tokens y costo interno"><UsageAreaChart records={usageSummary.records} /></Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel visible={isPanelVisible("projectValue")} title="Valor por proyecto" subtitle="Estimado, contratado y cobrado"><ProjectValueBarChart data={projectValueBars} /></Panel>
        <Panel visible={isPanelVisible("pipelineChart")} title="Pipeline por estado" subtitle="Propuestas agrupadas por etapa"><PipelineBarChart data={pipelineBars} /></Panel>
        <Panel visible={isPanelVisible("aiProjects")} title="IA por proyecto" subtitle="Ejecuciones y costo interno"><AiProjectBarChart data={aiProjectBars} /></Panel>
      </div>

      <Panel visible={isPanelVisible("portfolio")} title="Portfolio de proyectos" subtitle="Valores, estado y rentabilidad por proyecto"><PortfolioTable rows={portfolioRows} /></Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel visible={isPanelVisible("software")} title="Software producido" subtitle="Contenido indexado por proyecto"><ResponsiveContainer width="100%" height={220}><BarChart data={projectBars} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Bar dataKey="files" fill="#F8EAD8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("impact")} title="Progreso de impacto" subtitle="Resultados verificables del portfolio"><div className="space-y-4 pt-4"><ProgressRow label="Resultados completados" value={impactProgress} color="#67BAFF" /><ProgressRow label="Proyectos con impacto definido" value={percent(visibleBusiness.filter((item) => item.pricing.expected_impact).length, Math.max(1, visibleProjects.length))} color="#FFF3DF" /></div></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel visible={isPanelVisible("health")} title="Salud del negocio" subtitle="Radar de indicadores clave"><ResponsiveContainer width="100%" height={250}><RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%"><PolarGrid stroke="#2b2b2b" /><PolarAngleAxis dataKey="subject" tick={{ fill: "#777", fontSize: 10 }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Valor" dataKey="value" stroke="#1687FF" fill="#1687FF" fillOpacity={0.22} /></RadarChart></ResponsiveContainer></Panel>
        <Panel visible={isPanelVisible("objective")} title="Objetivo del período" subtitle="Progreso radial"><ResponsiveContainer width="100%" height={250}><RadialBarChart cx="50%" cy="50%" innerRadius="68%" outerRadius="92%" barSize={14} startAngle={90} endAngle={-270} data={radialData}><RadialBar background={{ fill: "#202020" }} dataKey="value" cornerRadius={10} /><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="28" fontWeight="600">{radialData[0].value}%</text><text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">completado</text></RadialBarChart></ResponsiveContainer></Panel>
      </div>

      <div className="hidden">
        <Panel title="Progreso general" subtitle="Objetivos del período"><ProgressRow label="Proyectos indexados" value={Math.min(100, projects.length * 12)} color={BUSINESS_TOKENS.electricBlue} /><ProgressRow label="Archivos organizados" value={Math.min(100, Math.round(totalFiles / 2))} color={BUSINESS_TOKENS.warmIvory} /><ProgressRow label="Entregas completadas" value={Math.min(100, projects.length * 18)} color={BUSINESS_TOKENS.lightCream} /></Panel>
        <Panel title="Actividad reciente" subtitle="Últimos movimientos"><div className="space-y-4 pt-3">{["Proyecto actualizado", "Archivos indexados", "Nuevo negocio creado"].map((item, index) => <div key={item} className="flex items-center gap-3"><div className="grid h-7 w-7 place-items-center rounded-lg bg-[#1c1c1c] text-[#777]"><CheckCircle2 size={14} /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-[#bbb]">{item}</div><div className="text-[10px] text-[#555]">Hace {index + 1} momentos</div></div></div>)}</div></Panel>
        <Panel title="Tendencia" subtitle="Crecimiento promedio"><div className="flex h-full min-h-[150px] flex-col justify-between pt-4"><div className="flex items-end gap-2"><TrendingUp size={18} className="mb-1 text-[#F8EAD8]" /><span className="text-3xl font-semibold tracking-tight text-[#eee]">+18.4%</span></div><div className="flex items-center gap-1 text-[11px] text-[#666]"><ArrowUpRight size={13} className="text-[#F8EAD8]" /> 6.2% más que el período anterior</div></div></Panel>
      </div>
    </div>
  </div>;
}

function UsagePeriodMenu({ usageFrom, usageTo, onFromChange, onToChange }: { usageFrom: string; usageTo: string; onFromChange: (value: string) => void; onToChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = Boolean(usageFrom || usageTo);
  useEffect(() => { if (!open) return; const handlePointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", handlePointerDown); return () => document.removeEventListener("pointerdown", handlePointerDown); }, [open]);
  return <div ref={menuRef} className="relative"><button type="button" onClick={() => setOpen((value) => !value)} className={`grid h-8 w-8 place-items-center rounded-lg border border-[#2b2b2b] bg-[#161616] ${active ? "text-[#aaa]" : "text-[#aaa]"} hover:bg-[#1c1c1c]`} style={active ? { color: BUSINESS_TOKENS.softBlue } : undefined} aria-label="Filtrar período de IA" title="Período de IA"><CalendarDays size={14} /></button>{open && <div className="absolute right-0 top-10 z-20 grid min-w-[220px] gap-2 rounded-xl border border-[#2b2b2b] bg-[#121212] p-3 shadow-xl"><div className="text-[10px] uppercase tracking-[0.08em] text-[#666]">Período de IA</div><label className="grid gap-1 text-[10px] text-[#777]">Desde<input type="date" value={usageFrom} onChange={(event) => onFromChange(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[10px] text-[#ccc]" /></label><label className="grid gap-1 text-[10px] text-[#777]">Hasta<input type="date" value={usageTo} onChange={(event) => onToChange(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[10px] text-[#ccc]" /></label>{active && <button type="button" onClick={() => { onFromChange(""); onToChange(""); }} className="rounded-lg px-2 py-1.5 text-left text-[10px] text-[#aaa] hover:bg-[#1c1c1c]">Limpiar período</button>}</div>}</div>;
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
  return <div ref={menuRef} className="relative"><button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#2b2b2b] bg-[#161616] text-[#aaa] hover:bg-[#1c1c1c] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Configurar paneles" title="Mostrar u ocultar paneles"><Settings2 size={14} /></button>{open && <div className="absolute right-0 top-10 z-20 min-w-[190px] rounded-xl border border-[#2b2b2b] bg-[#121212] p-2 shadow-xl"><div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.08em] text-[#666]">Paneles visibles</div>{dashboardPanels.map((panel) => <label key={panel.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-[#bbb] hover:bg-[#1e1e1e]"><input type="checkbox" checked={visiblePanels[panel.id] !== false} onChange={() => void onToggle(panel.id)} style={{ accentColor: BUSINESS_TOKENS.electricBlue }} />{panel.label}</label>)}</div>}</div>;
}

const formatActivityTime = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return `Hace ${Math.floor(hours / 24)} d`;
};

function buildActivityHistory(projects: ProjectEntry[], executionLogs: ExecutionLogRecord[], usage: GenerationUsageRecord[]): ActivityCard[] {
  const projectNames = new Map(projects.map((project) => [project.path, project.name]));
  const executionEvents: ActivityCard[] = executionLogs.map((entry) => {
    const timestamp = new Date(entry.at).getTime();
    const output = entry.output as any;
    const failed = Boolean(output?.error || output?.status === "error" || output?.ok === false);
    const title = entry.tool.includes(".") ? entry.tool.split(".").pop() || entry.tool : entry.tool;
    return { id: `execution-${entry.id}`, title: failed ? "Error detectado" : title, detail: projectNames.get(entry.projectPath) || "Workspace global", time: formatActivityTime(timestamp), color: failed ? BUSINESS_TOKENS.electricOrange : entry.tool.startsWith("generation") ? BUSINESS_TOKENS.warmIvory : BUSINESS_TOKENS.electricBlue, at: Number.isFinite(timestamp) ? timestamp : 0 };
  });
  const usageEvents: ActivityCard[] = usage.map((entry) => {
    const timestamp = new Date(entry.at).getTime();
    return { id: `usage-${entry.id}`, title: entry.status === "error" ? "Generación fallida" : "Generación IA", detail: entry.model || entry.provider || "Modelo", time: formatActivityTime(timestamp), color: entry.status === "error" ? BUSINESS_TOKENS.softPeach : BUSINESS_TOKENS.softBlue, at: Number.isFinite(timestamp) ? timestamp : 0 };
  });
  return [...executionEvents, ...usageEvents].filter((event) => event.at > 0).sort((a, b) => b.at - a.at).slice(0, 15);
}

function DeveloperCard({ events }: { events: ActivityCard[] }) {
  const historyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = historyRef.current;
    if (!element) return;
    dragRef.current = { active: true, startX: event.clientX, scrollLeft: element.scrollLeft };
    element.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !historyRef.current) return;
    event.preventDefault();
    historyRef.current.scrollLeft = dragRef.current.scrollLeft - (event.clientX - dragRef.current.startX);
  };
  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    if (historyRef.current?.hasPointerCapture(event.pointerId)) historyRef.current.releasePointerCapture(event.pointerId);
  };
  return <section className="rounded-xl border border-[#202020] p-4"><div className="flex flex-col gap-4 md:flex-row md:items-center"><div className="flex items-center gap-3"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-[#1a1a1a]" style={{ background: "linear-gradient(112deg, #1687ff 0%, #67baff 38%, #f8ead8 68%, #fff3df 100%)", boxShadow: "0 0 18px rgba(22, 135, 255, 0.18), inset 0 1px rgba(255, 255, 255, 0.32)" }}>IG</div><div><div className="text-base font-medium text-[#eee]">Iange</div><div className="mt-1 text-[11px] text-[#777]">Desarrollador full-stack · Codeclub</div><div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[9px] text-[#666]"><span className="flex items-center gap-1"><MapPin size={11} /> Buenos Aires</span><span className="flex items-center gap-1"><Mail size={11} /> iange@codeclub.dev</span></div></div></div></div><div className="mt-4 border-t border-[#202020] pt-3"><div ref={historyRef} className="business-history-ribbon flex cursor-grab select-none gap-0 overflow-x-auto pb-1 active:cursor-grabbing" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} style={{ scrollbarWidth: "thin", scrollbarColor: "#2b2b2b transparent", touchAction: "pan-x" }}><div className="business-history-track flex w-max items-stretch gap-1.5">{events.length ? events.map((event) => <div key={event.id} className="flex h-[68px] w-[148px] shrink-0 flex-col rounded-lg border border-[#202020] bg-[#151515] p-2"><div className="mb-1.5 h-1.5 w-1.5 shrink-0 rounded-full opacity-80" style={{ backgroundColor: event.color }} /><div className="truncate text-[9px] font-medium text-[#c4c4c4]">{event.title}</div><div className="mt-0.5 truncate text-[8px] text-[#707070]">{event.detail}</div><div className="mt-auto text-[8px] text-[#555]">{event.time}</div></div>) : <div className="flex h-[68px] items-center px-2 text-[9px] text-[#666]">Sin actividad registrada</div>}</div></div></div></section>;
}

function ProjectValueBarChart({ data }: { data: Array<{ name: string; estimated: number; contracted: number; revenue: number }> }) {
  return <ResponsiveContainer width="100%" height={230}><BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 4, bottom: 0 }}><CartesianGrid stroke={chartGrid} horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 9 }} /><YAxis type="category" dataKey="name" width={78} axisLine={false} tickLine={false} tick={{ fill: "#888", fontSize: 9 }} /><Tooltip contentStyle={chartTooltip} formatter={(value: number | undefined) => formatMoney(Number(value || 0))} /><Bar dataKey="estimated" name="Estimado" fill={BUSINESS_TOKENS.warmIvory} radius={[0, 3, 3, 0]} /><Bar dataKey="contracted" name="Contratado" fill={BUSINESS_TOKENS.softBlue} radius={[0, 3, 3, 0]} /><Bar dataKey="revenue" name="Cobrado" fill={BUSINESS_TOKENS.electricBlue} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer>;
}

function PipelineBarChart({ data }: { data: Array<{ name: string; draft: number; sent: number; accepted: number; contracted: number }> }) {
  return <ResponsiveContainer width="100%" height={230}><BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#777", fontSize: 9 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 9 }} /><Tooltip contentStyle={chartTooltip} formatter={(value: number | undefined) => formatMoney(Number(value || 0))} /><Bar dataKey="draft" name="Borrador" stackId="pipeline" fill={BUSINESS_TOKENS.softPeach} /><Bar dataKey="sent" name="Enviada" stackId="pipeline" fill={BUSINESS_TOKENS.softBlue} /><Bar dataKey="accepted" name="Aceptada" stackId="pipeline" fill={BUSINESS_TOKENS.lightCream} /><Bar dataKey="contracted" name="Contratada" stackId="pipeline" fill={BUSINESS_TOKENS.electricBlue} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>;
}

function AiProjectBarChart({ data }: { data: Array<{ name: string; generations: number; cost: number }> }) {
  return <ResponsiveContainer width="100%" height={230}><BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#777", fontSize: 9 }} /><YAxis yAxisId="left" axisLine={false} axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 9 }} /><YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 9 }} /><Tooltip contentStyle={chartTooltip} formatter={(value: number | undefined, name: string | undefined) => [name === "Costo" ? formatMoney(Number(value || 0)) : Number(value || 0), name || ""]} /><Bar yAxisId="left" dataKey="generations" name="Ejecuciones" fill={BUSINESS_TOKENS.softBlue} radius={[3, 3, 0, 0]} /><Bar yAxisId="right" dataKey="cost" name="Costo" fill={BUSINESS_TOKENS.electricOrange} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>;
}

function MetricAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-[#202020]"><button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between bg-[#151515] px-4 py-3 text-left text-xs text-[#ddd] transition-colors hover:bg-[#1c1c1c]"><span>{title}</span><ChevronDown size={14} className={`text-[#777] transition-transform duration-200 ${open ? "rotate-180" : ""}`} /></button><div className={`grid transition-[grid-template-rows,opacity] duration-220 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden p-3">{children}</div></div></section>;
}

function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  const [sortKey, setSortKey] = useState<"name" | "estimated" | "margin" | "status">("estimated");
  const [expanded, setExpanded] = useState<string | null>(null);
  const sortedRows = [...rows].sort((left, right) => sortKey === "name" || sortKey === "status" ? String(left[sortKey]).localeCompare(String(right[sortKey])) : Number(right[sortKey]) - Number(left[sortKey]));
  if (!rows.length) return <div className="rounded-xl border border-dashed border-[#2b2b2b] p-8 text-center text-[11px] text-[#777]">No hay proyectos para mostrar todavía.</div>;
  const header = (key: typeof sortKey, label: string) => <button type="button" onClick={() => setSortKey(key)} className="text-left text-[10px] uppercase tracking-[0.08em] text-[#777] hover:text-[#eee]">{label}{sortKey === key ? " ↓" : ""}</button>;
  return <div className="overflow-x-auto rounded-xl border border-[#202020]"><table className="w-full min-w-[720px] border-collapse text-left"><thead className="bg-[#161616]"><tr><th className="px-3 py-2.5">{header("name", "Proyecto")}</th><th className="px-3 py-2.5">{header("status", "Estado")}</th><th className="px-3 py-2.5 text-right">{header("estimated", "Valor")}</th><th className="px-3 py-2.5 text-right">Contratado</th><th className="px-3 py-2.5 text-right">Margen</th><th className="px-3 py-2.5 text-right">Cotizaciones</th></tr></thead><tbody>{sortedRows.map((row) => <React.Fragment key={row.path}><tr className="border-t border-[#202020] transition-colors hover:bg-[#191919]"><td className="px-3 py-2.5"><button type="button" onClick={() => setExpanded(expanded === row.path ? null : row.path)} className="max-w-[220px] truncate text-xs text-[#ddd]" style={{ color: expanded === row.path ? BUSINESS_TOKENS.softBlue : undefined }} title="Ver detalle del proyecto">{expanded === row.path ? "⌄ " : "› "}{row.name}</button></td><td className="px-3 py-2.5 text-[11px] text-[#999]">{row.status}</td><td className="px-3 py-2.5 text-right text-[11px] text-[#ddd]" title="Valor estimado guardado">{formatMoney(row.estimated)}</td><td className="px-3 py-2.5 text-right text-[11px] text-[#ddd]">{formatMoney(row.contracted)}</td><td className="px-3 py-2.5 text-right text-[11px]" style={{ color: row.margin < 0 ? BUSINESS_TOKENS.electricOrange : BUSINESS_TOKENS.softBlue }} title="Resultado neto sobre ingresos">{formatMoney(row.margin)}</td><td className="px-3 py-2.5 text-right text-[11px] text-[#999]">{row.quotes}</td></tr>{expanded === row.path && <tr className="border-t border-[#202020] bg-[#141414]"><td colSpan={6} className="px-4 py-3"><div className="grid grid-cols-2 gap-3 text-[10px] text-[#777] md:grid-cols-4"><div><div>Ingresos</div><strong className="text-[#ddd]">{formatMoney(row.revenue)}</strong></div><div><div>Gastos</div><strong className="text-[#ddd]">{formatMoney(row.expenses)}</strong></div><div><div>Resultados</div><strong className="text-[#ddd]">{row.completedResults}/{row.totalResults}</strong></div><div><div>Impacto</div><strong style={{ color: BUSINESS_TOKENS.softBlue }}> {row.impact}%</strong></div></div></td></tr>}</React.Fragment>)}</tbody></table></div>;
}

function UsageAreaChart({ records }: { records: GenerationUsageRecord[] }) {
  const [timeRange, setTimeRange] = useState("90d");
  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  const data = useMemo(() => buildUsageActivity(records, days), [records, days]);
  return <div className="pt-1"><div className="mb-3 flex items-center justify-end"><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[10px] text-[#ccc] outline-none" aria-label="Período de actividad de IA"><option value="90d">Últimos 3 meses</option><option value="30d">Últimos 30 días</option><option value="7d">Últimos 7 días</option></select></div><ResponsiveContainer width="100%" height={250}><AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}><defs><linearGradient id="fillGenerations" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={BUSINESS_TOKENS.electricBlue} stopOpacity={0.65} /><stop offset="95%" stopColor={BUSINESS_TOKENS.electricBlue} stopOpacity={0.04} /></linearGradient><linearGradient id="fillTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={BUSINESS_TOKENS.softBlue} stopOpacity={0.45} /><stop offset="95%" stopColor={BUSINESS_TOKENS.softBlue} stopOpacity={0.04} /></linearGradient></defs><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} minTickGap={28} tickFormatter={(value) => new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { month: "short", day: "numeric" })} /><YAxis yAxisId="left" domain={[0, "auto"]} allowDataOverflow={false} axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis yAxisId="right" domain={[0, "auto"]} allowDataOverflow={false} orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} labelFormatter={(value) => new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { dateStyle: "medium" })} formatter={(value: number | undefined, name: string | undefined) => [name === "cost" ? formatMoney(Number(value || 0)) : formatCompact(Number(value || 0)), name === "generations" ? "Generaciones" : name === "tokens" ? "Tokens" : "Costo"]} /><Area yAxisId="left" dataKey="tokens" type="natural" baseValue={0} fill="url(#fillTokens)" stroke={BUSINESS_TOKENS.softBlue} strokeWidth={1.5} stackId="a" /><Area yAxisId="left" dataKey="generations" type="natural" baseValue={0} fill="url(#fillGenerations)" stroke={BUSINESS_TOKENS.electricBlue} strokeWidth={1.8} stackId="a" /></AreaChart></ResponsiveContainer><div className="mt-1 flex flex-wrap items-center justify-center gap-4 text-[10px] text-[#777]"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: BUSINESS_TOKENS.electricBlue }} />Generaciones</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: BUSINESS_TOKENS.softBlue }} />Tokens</span><span className="text-[#666]">Costo: visible en tooltip</span></div></div>;
}

function BusinessFunnel({ stages }: { stages: Array<{ label: string; value: number }> }) {
  const maximum = Math.max(...stages.map((stage) => stage.value), 1);
  return <div className="space-y-2 pt-2">{stages.map((stage, index) => <motion.div key={stage.label} initial={{ opacity: 0, scaleX: 0.72 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.35, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }} whileHover={{ scale: 1.015 }} style={{ width: `${Math.max(18, (stage.value / maximum) * 100)}%`, transformOrigin: "left" }} className="flex min-h-10 min-w-[150px] items-center justify-between gap-3 rounded-lg border border-[#2b2b2b] bg-[#171717] px-3 text-[11px] text-[#ccc]"><span>{stage.label}</span><span className="font-medium text-[#eee]">{formatMoney(stage.value)}</span></motion.div>)}</div>;
}

function DashboardCard({ title, subtitle, label, value, detail, progress = 0, variant, accent = "#67BAFF", visible = true }: { title: string; subtitle: string; label: string; value: string; detail: string; progress?: number; variant: "metric" | "progress" | "trend" | "status"; accent?: string; visible?: boolean }) {
  if (!visible) return null;
  return <section className="rounded-xl border bg-[#151515] p-4" style={{ borderColor: `${accent}38` }}><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-medium text-[#ddd]">{title}</div><div className="mt-1 text-[10px] text-[#666]">{subtitle}</div></div><span className="rounded-md px-1.5 py-1 text-[9px] uppercase tracking-[0.08em]" style={{ color: accent, backgroundColor: `${accent}18` }}>{variant}</span></div><div className="mt-4"><div className="text-[10px] text-[#666]">{label}</div><div className="mt-1 text-2xl font-medium tracking-tight text-[#eee]">{value}</div>{variant === "progress" && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-[#202020]"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: accent }} /></div><div className="mt-1 text-[10px] text-[#777]">{Math.round(progress)}% del objetivo</div></div>}{variant === "trend" && <div className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: accent }}><ArrowUpRight size={12} />Indicador de tendencia</div>}{variant === "status" && <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: accent }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />Estado actual</div>}<div className="mt-2 text-[10px] text-[#666]">{detail}</div></div></section>;
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

type PortfolioRow = { path: string; name: string; status: string; estimated: number; contracted: number; revenue: number; expenses: number; margin: number; quotes: number; completedResults: number; totalResults: number; impact: number; hasBusinessData: boolean };

function buildPortfolioRows(projects: ProjectEntry[], business: Record<string, BusinessWorkspace | null>): PortfolioRow[] {
  return projects.map((project) => {
    const item = business[project.path];
    const revenue = (item?.invoices || []).reduce((sum: number, invoice: any) => sum + Number(invoice.amount || invoice.total || 0), 0);
    const expenses = (item?.expenses || []).reduce((sum: number, expense: any) => sum + Number(expense.amount || 0), 0);
    const results = item?.outcomes?.length ? item.outcomes : item?.milestones || [];
    const completedResults = results.filter((result: any) => ["completed", "completado", "done"].includes(String(result.status).toLowerCase())).length;
    return { path: project.path, name: project.name, status: String(item?.project.status || "sin datos"), estimated: Number(item?.project.estimated_value || 0), contracted: Number(item?.project.contracted_value || 0), revenue, expenses, margin: revenue - expenses, quotes: item?.quotes?.length || 0, completedResults, totalResults: results.length, impact: percent(completedResults, results.length), hasBusinessData: Boolean(item) };
  });
}

function buildProjectValueBars(projects: ProjectEntry[], business: Record<string, BusinessWorkspace | null>) {
  return projects.map((project) => {
    const item = business[project.path];
    return { name: project.name.slice(0, 12), estimated: Number(item?.project.estimated_value || 0), contracted: Number(item?.project.contracted_value || 0), revenue: (item?.invoices || []).reduce((sum: number, invoice: any) => sum + Number(invoice.amount || invoice.total || 0), 0) };
  }).filter((item) => item.estimated || item.contracted || item.revenue).slice(0, 8);
}

function buildPipelineBars(projects: ProjectEntry[], business: Record<string, BusinessWorkspace | null>) {
  return projects.map((project) => {
    const quotes = business[project.path]?.quotes || [];
    return { name: project.name.slice(0, 10), draft: quotes.filter((quote: any) => String(quote.status || "draft") === "draft").reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0), sent: quotes.filter((quote: any) => String(quote.status || "draft") === "sent").reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0), accepted: quotes.filter((quote: any) => quote.status === "accepted").reduce((sum: number, quote: any) => sum + Number(quote.total || 0), 0), contracted: Number(business[project.path]?.project.contracted_value || 0) };
  }).filter((item) => item.draft || item.sent || item.accepted || item.contracted).slice(0, 8);
}

function buildAiProjectBars(projects: ProjectEntry[], usage: Record<string, GenerationUsageRecord[]>) {
  return projects.map((project) => {
    const records = usage[project.path] || [];
    return { name: project.name.slice(0, 10), generations: records.length, cost: records.reduce((sum, record) => sum + (Number(record.inputTokens || 0) / 1_000_000) * Number(record.inputCostPerMillion || 0) + (Number(record.outputTokens || 0) / 1_000_000) * Number(record.outputCostPerMillion || 0), 0) };
  }).filter((item) => item.generations || item.cost).slice(0, 8);
}

function buildUsageActivity(records: GenerationUsageRecord[], days = 90) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, generations: 0, tokens: 0, cost: 0 };
  });
  const byKey = new Map(points.map((item) => [item.date, item]));
  records.forEach((record) => {
    const date = new Date(record.at);
    if (Number.isNaN(date.getTime())) return;
    const bucket = byKey.get(date.toISOString().slice(0, 10));
    if (!bucket) return;
    bucket.generations += 1;
    bucket.tokens += Number(record.totalTokens || 0);
    bucket.cost += (Number(record.inputTokens || 0) / 1_000_000) * Number(record.inputCostPerMillion || 0) + (Number(record.outputTokens || 0) / 1_000_000) * Number(record.outputCostPerMillion || 0);
  });
  return points;
}
