import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, ChevronDown, MapPin, Mail, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readBusinessWorkspace, readProjectIndex, type BusinessWorkspace, type ProjectEntry } from "../lib/projectManager";
import { readGenerationUsage, summarizeGenerationUsage, type GenerationUsageRecord } from "../lib/usage";

const chartTooltip = { backgroundColor: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, color: "#ddd", fontSize: 11 };
const chartGrid = "#242424";
const colors = ["#c7cbff", "#86efac", "#fde68a", "#f9a8d4"];


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
  const visibleUsage = visibleProjects.flatMap((project) => usage[project.path] || []);
  const usageSummary = summarizeGenerationUsage(visibleUsage, usageFrom || undefined, usageTo || undefined);
  const totalFiles = visibleProjects.reduce((sum, project) => sum + (project.file_count || 0), 0);
  const totalRevenue = visibleBusiness.flatMap((item) => item.invoices).reduce((sum, item: any) => sum + Number(item.amount || item.total || 0), 0);
  const totalExpenses = visibleBusiness.flatMap((item) => item.expenses).reduce((sum, item: any) => sum + Number(item.amount || 0), 0);
  const totalHours = visibleBusiness.flatMap((item) => item.time_entries).reduce((sum, item: any) => sum + Number(item.hours || 0), 0);
  const monthlyFees = visibleBusiness.reduce((sum, item) => sum + Number(item.project.monthly_fee || item.pricing.retainer_monthly || 0), 0);
  const quoteCount = visibleBusiness.reduce((sum, item) => sum + item.quotes.length, 0);
  const projectBars = visibleProjects.slice().sort((a, b) => (b.file_count || 0) - (a.file_count || 0)).slice(0, 6).map((project) => ({ name: project.name.slice(0, 12), files: project.file_count || 0 }));
  const activity = useMemo(() => buildMonthlyActivity(visibleBusiness), [visibleBusiness]);
  const statusData = buildStatusData(visibleProjects, business);
  const totalMilestones = visibleBusiness.reduce((sum, item) => sum + item.milestones.length, 0);
  const completedMilestones = visibleBusiness.reduce((sum, item) => sum + item.milestones.filter((milestone: any) => ["completed", "completado", "done"].includes(String(milestone.status).toLowerCase())).length, 0);
  const projectsWithData = visibleBusiness.length;
  const radarData = [{ subject: "Cotización", value: percent(visibleBusiness.reduce((sum, item) => sum + item.quotes.length, 0), Math.max(1, visibleProjects.length)) }, { subject: "Entrega", value: percent(completedMilestones, totalMilestones) }, { subject: "Margen", value: percent(totalRevenue - totalExpenses, totalRevenue) }, { subject: "Registro", value: percent(totalHours, Math.max(1, totalHours + visibleBusiness.length * 10)) }, { subject: "Datos", value: percent(projectsWithData, visibleProjects.length) }];
  const radialData = [{ name: "Hitos", value: percent(completedMilestones, totalMilestones), fill: "#c7cbff" }];
  const netResult = totalRevenue - totalExpenses;

  if (loading) return <div className="h-full w-full overflow-auto p-6"><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-[#161616]" />)}</div><div className="mt-3 h-72 animate-pulse rounded-xl bg-[#161616]" /></div>;

  return <div className="business-dashboard-scrollbar absolute inset-0 overflow-auto overscroll-contain p-5 md:p-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="hidden"><div>Negocios</div></div>

      <div className="relative"><div className="absolute right-5 top-5 z-10"><ProjectFilterMenu projects={projects} selectedProjectPath={selectedProjectPath} onProjectChange={setSelectedProjectPath} /></div><DeveloperCard projects={projects} selectedProjectPath={selectedProjectPath} onProjectChange={setSelectedProjectPath} /></div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#202020] p-3 text-[11px] text-[#777]">
        <span>Período IA</span>
        <input type="date" value={usageFrom} onChange={(event) => setUsageFrom(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[#ccc]" aria-label="Desde" />
        <span>—</span>
        <input type="date" value={usageTo} onChange={(event) => setUsageTo(event.target.value)} className="rounded-lg border border-[#2b2b2b] bg-[#161616] px-2 py-1.5 text-[#ccc]" aria-label="Hasta" />
        {(usageFrom || usageTo) && <button type="button" onClick={() => { setUsageFrom(""); setUsageTo(""); }} className="rounded-lg px-2 py-1.5 text-[#aaa] hover:bg-[#1c1c1c]">Limpiar</button>}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Panel title="Ingresos" subtitle="Facturas y cobros registrados"><Metric label="Total" value={formatMoney(totalRevenue)} /></Panel>
        <Panel title="Gastos" subtitle="Costos cargados en proyectos"><Metric label="Total" value={formatMoney(totalExpenses)} /></Panel>
        <Panel title="Horas" subtitle="Tiempo registrado"><Metric label="Total" value={String(totalHours)} /></Panel>
        <Panel title="Abonos" subtitle={`${quoteCount} cotización${quoteCount === 1 ? "" : "es"}`}><Metric label="Mensual" value={formatMoney(monthlyFees)} /></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Panel title="Generaciones IA" subtitle="Outputs producidos"><Metric label="Ejecuciones" value={String(usageSummary.generations)} /></Panel>
        <Panel title="Tokens" subtitle="Entrada + salida"><Metric label="Total" value={formatCompact(usageSummary.totalTokens)} /></Panel>
        <Panel title="Costo IA estimado" subtitle="Según tarifa del modelo"><Metric label="USD" value={formatMoney(usageSummary.estimatedCost)} /></Panel>
        <Panel title="Tiempo IA" subtitle="Duración acumulada"><Metric label="Total" value={formatDuration(usageSummary.durationMs)} /></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <Panel title="Actividad registrada" subtitle="Cotizaciones y movimientos reales"><ResponsiveContainer width="100%" height={260}><AreaChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="businessGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c7cbff" stopOpacity={0.3} /><stop offset="100%" stopColor="#c7cbff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Area type="monotone" dataKey="quotes" stroke="#c7cbff" strokeWidth={2} fill="url(#businessGradient)" /><Area type="monotone" dataKey="movements" stroke="#86efac" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></Panel>
        <Panel title="Distribución" subtitle="Estado actual de los negocios"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none">{statusData.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}</Pie><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="22" fontWeight="600">{projects.length}</text><text x="50%" y="57%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">total</text></PieChart></ResponsiveContainer><div className="grid grid-cols-2 gap-2 px-2 pb-1">{statusData.map((status, index) => <div key={status.name} className="flex items-center gap-2 text-[10px] text-[#777]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index] }} />{status.name}</div>)}</div></Panel>
      </div>

      <Panel title="Actividad de IA por proyecto" subtitle="Generaciones, tokens y costo estimado"><ResponsiveContainer width="100%" height={240}><LineChart data={buildUsageActivity(usageSummary.records)} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Line yAxisId="left" type="monotone" dataKey="generations" stroke="#c7cbff" strokeWidth={2} dot={{ fill: "#c7cbff", r: 3 }} /><Line yAxisId="left" type="monotone" dataKey="tokens" stroke="#86efac" strokeWidth={2} dot={{ fill: "#86efac", r: 3 }} /><Line yAxisId="right" type="monotone" dataKey="cost" stroke="#fde68a" strokeWidth={2} dot={{ fill: "#fde68a", r: 3 }} /></LineChart></ResponsiveContainer></Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Archivos por proyecto" subtitle="Distribución del contenido indexado"><ResponsiveContainer width="100%" height={220}><BarChart data={projectBars} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Bar dataKey="files" fill="#c7cbff" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Panel>
        <Panel title="Rendimiento" subtitle="Horas y movimientos registrados"><ResponsiveContainer width="100%" height={220}><LineChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Line type="monotone" dataKey="hours" stroke="#86efac" strokeWidth={2} dot={{ fill: "#86efac", r: 3 }} /><Line type="monotone" dataKey="movements" stroke="#fde68a" strokeWidth={2} dot={{ fill: "#fde68a", r: 3 }} /></LineChart></ResponsiveContainer></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Salud del negocio" subtitle="Radar de indicadores clave"><ResponsiveContainer width="100%" height={250}><RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%"><PolarGrid stroke="#2b2b2b" /><PolarAngleAxis dataKey="subject" tick={{ fill: "#777", fontSize: 10 }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Valor" dataKey="value" stroke="#c7cbff" fill="#c7cbff" fillOpacity={0.22} /></RadarChart></ResponsiveContainer></Panel>
        <Panel title="Objetivo del período" subtitle="Progreso radial"><ResponsiveContainer width="100%" height={250}><RadialBarChart cx="50%" cy="50%" innerRadius="68%" outerRadius="92%" barSize={14} startAngle={90} endAngle={-270} data={radialData}><RadialBar background={{ fill: "#202020" }} dataKey="value" cornerRadius={10} /><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="28" fontWeight="600">{radialData[0].value}%</text><text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">completado</text></RadialBarChart></ResponsiveContainer></Panel>
      </div>

      <div className="hidden">
        <Panel title="Progreso general" subtitle="Objetivos del período"><ProgressRow label="Proyectos indexados" value={Math.min(100, projects.length * 12)} color="#c7cbff" /><ProgressRow label="Archivos organizados" value={Math.min(100, Math.round(totalFiles / 2))} color="#86efac" /><ProgressRow label="Entregas completadas" value={Math.min(100, projects.length * 18)} color="#fde68a" /></Panel>
        <Panel title="Actividad reciente" subtitle="Últimos movimientos"><div className="space-y-4 pt-3">{["Proyecto actualizado", "Archivos indexados", "Nuevo negocio creado"].map((item, index) => <div key={item} className="flex items-center gap-3"><div className="grid h-7 w-7 place-items-center rounded-lg bg-[#1c1c1c] text-[#777]"><CheckCircle2 size={14} /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-[#bbb]">{item}</div><div className="text-[10px] text-[#555]">Hace {index + 1} horas</div></div></div>)}</div></Panel>
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

function DeveloperCard({ projects, selectedProjectPath, onProjectChange }: { projects: ProjectEntry[]; selectedProjectPath: string; onProjectChange: (path: string) => void }) {
  const changes = [
    { title: "Proyecto indexado", detail: "Codeclub Desktop", time: "Hace 12 min", color: "#c7cbff" },
    { title: "Archivos actualizados", detail: "src/components", time: "Hace 28 min", color: "#86efac" },
    { title: "Entrega completada", detail: "Dashboard de Negocios", time: "Hace 1 h", color: "#fde68a" },
    { title: "Chat iniciado", detail: "Sin proyecto", time: "Hace 2 h", color: "#f9a8d4" },
  ];
  return <section className="rounded-xl border border-[#202020] p-5"><div className="flex flex-col gap-5 md:flex-row md:items-center"><div className="flex items-center gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#c7cbff] text-xl font-semibold text-[#1a1a1a]">IG</div><div><div className="text-lg font-medium text-[#eee]">Iange</div><div className="mt-1 text-xs text-[#777]">Desarrollador full-stack · Codeclub</div><div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[#666]"><span className="flex items-center gap-1"><MapPin size={12} /> Buenos Aires</span><span className="flex items-center gap-1"><Mail size={12} /> iange@codeclub.dev</span></div></div></div></div><div className="mt-5 border-t border-[#202020] pt-4"><div className="business-history-ribbon overflow-hidden"><div className="business-history-track flex w-max gap-2">{[...changes, ...changes].map((change, index) => <div key={`${change.title}-${index}`} className="w-[170px] shrink-0 rounded-lg border border-[#202020] p-2.5"><div className="mb-2 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: change.color }} /><div className="truncate text-[10px] font-medium text-[#ccc]">{change.title}</div><div className="mt-1 truncate text-[9px] text-[#777]">{change.detail}</div><div className="mt-2 text-[9px] text-[#555]">{change.time}</div></div>)}</div></div></div></section>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() - (5 - index)); return { key: `${date.getFullYear()}-${date.getMonth()}`, month: date.toLocaleDateString("es-AR", { month: "short" }), quotes: 0, movements: 0, hours: 0 }; });
  const byKey = new Map(months.map((item) => [item.key, item]));
  const add = (entries: any[], kind: "quotes" | "movements" | "hours") => entries.forEach((entry) => { const rawDate = entry.date || entry.created_at || entry.updated_at || entry.issued_at; if (!rawDate) return; const date = new Date(rawDate); if (Number.isNaN(date.getTime())) return; const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`); if (!bucket) return; bucket[kind] += kind === "hours" ? Number(entry.hours || 0) : 1; });
  items.forEach((item) => { add(item.quotes, "quotes"); add(item.invoices, "movements"); add(item.expenses, "movements"); add(item.payments, "movements"); add(item.time_entries, "hours"); });
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
