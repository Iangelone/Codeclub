import React, { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, CheckCircle2, MapPin, Mail, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readProjectIndex, type ProjectEntry } from "../lib/projectManager";

const chartTooltip = { backgroundColor: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, color: "#ddd", fontSize: 11 };
const chartGrid = "#242424";
const colors = ["#c7cbff", "#86efac", "#fde68a", "#f9a8d4"];


export default function BusinessPanel() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => { setProjects(await readProjectIndex()); setLoading(false); };
    void load();
    window.addEventListener("codeclub:project-indexed", load);
    return () => window.removeEventListener("codeclub:project-indexed", load);
  }, []);

  const totalFiles = projects.reduce((sum, project) => sum + (project.file_count || 0), 0);
  const projectBars = projects.slice().sort((a, b) => (b.file_count || 0) - (a.file_count || 0)).slice(0, 6).map((project) => ({ name: project.name.slice(0, 12), files: project.file_count || 0 }));
  const activity = useMemo(() => ["Ene", "Feb", "Mar", "Abr", "May", "Jun"].map((month, index) => ({ month, negocios: Math.max(2, projects.length + index * 2), entregas: Math.max(1, Math.round((totalFiles / 24) + index)) })), [projects.length, totalFiles]);
  const statusData = [{ name: "En curso", value: Math.max(1, projects.length) }, { name: "Completado", value: Math.max(1, Math.round(projects.length * 0.6)) }, { name: "Pendiente", value: Math.max(1, Math.round(projects.length * 0.35)) }, { name: "Pausado", value: Math.max(1, Math.round(projects.length * 0.2)) }];
  const radarData = [{ subject: "Alcance", value: Math.min(100, projects.length * 15) }, { subject: "Entrega", value: Math.min(100, totalFiles / 2) }, { subject: "Calidad", value: 78 }, { subject: "Ritmo", value: 66 }, { subject: "Orden", value: 84 }];
  const radialData = [{ name: "Progreso", value: Math.min(100, projects.length * 16), fill: "#c7cbff" }];

  if (loading) return <div className="h-full w-full overflow-auto p-6"><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-[#161616]" />)}</div><div className="mt-3 h-72 animate-pulse rounded-xl bg-[#161616]" /></div>;

  return <div className="business-dashboard-scrollbar absolute inset-0 overflow-auto overscroll-contain p-5 md:p-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="hidden"><div>Negocios</div></div>

      <DeveloperCard />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <Panel title="Actividad general" subtitle="Evolución de negocios y entregas"><ResponsiveContainer width="100%" height={260}><AreaChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="businessGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c7cbff" stopOpacity={0.3} /><stop offset="100%" stopColor="#c7cbff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Area type="monotone" dataKey="negocios" stroke="#c7cbff" strokeWidth={2} fill="url(#businessGradient)" /><Area type="monotone" dataKey="entregas" stroke="#86efac" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></Panel>
        <Panel title="Distribución" subtitle="Estado actual de los negocios"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={65} outerRadius={95} paddingAngle={3} stroke="none">{statusData.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}</Pie><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="22" fontWeight="600">{projects.length}</text><text x="50%" y="57%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">total</text></PieChart></ResponsiveContainer><div className="grid grid-cols-2 gap-2 px-2 pb-1">{statusData.map((status, index) => <div key={status.name} className="flex items-center gap-2 text-[10px] text-[#777]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index] }} />{status.name}</div>)}</div></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Archivos por proyecto" subtitle="Distribución del contenido indexado"><ResponsiveContainer width="100%" height={220}><BarChart data={projectBars} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Bar dataKey="files" fill="#c7cbff" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Panel>
        <Panel title="Rendimiento" subtitle="Comparativa mensual"><ResponsiveContainer width="100%" height={220}><LineChart data={activity} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke={chartGrid} vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#666", fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} /><Line type="monotone" dataKey="entregas" stroke="#86efac" strokeWidth={2} dot={{ fill: "#86efac", r: 3 }} /><Line type="monotone" dataKey="negocios" stroke="#fde68a" strokeWidth={2} dot={{ fill: "#fde68a", r: 3 }} /></LineChart></ResponsiveContainer></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Salud del negocio" subtitle="Radar de indicadores clave"><ResponsiveContainer width="100%" height={250}><RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%"><PolarGrid stroke="#2b2b2b" /><PolarAngleAxis dataKey="subject" tick={{ fill: "#777", fontSize: 10 }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Valor" dataKey="value" stroke="#c7cbff" fill="#c7cbff" fillOpacity={0.22} /></RadarChart></ResponsiveContainer></Panel>
        <Panel title="Objetivo del período" subtitle="Progreso radial"><ResponsiveContainer width="100%" height={250}><RadialBarChart cx="50%" cy="50%" innerRadius="68%" outerRadius="92%" barSize={14} startAngle={90} endAngle={-270} data={radialData}><RadialBar background={{ fill: "#202020" }} dataKey="value" cornerRadius={10} /><Tooltip contentStyle={chartTooltip} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#eee" fontSize="28" fontWeight="600">{radialData[0].value}%</text><text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize="10">completado</text></RadialBarChart></ResponsiveContainer></Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
        <Panel title="Progreso general" subtitle="Objetivos del período"><ProgressRow label="Proyectos indexados" value={Math.min(100, projects.length * 12)} color="#c7cbff" /><ProgressRow label="Archivos organizados" value={Math.min(100, Math.round(totalFiles / 2))} color="#86efac" /><ProgressRow label="Entregas completadas" value={Math.min(100, projects.length * 18)} color="#fde68a" /></Panel>
        <Panel title="Actividad reciente" subtitle="Últimos movimientos"><div className="space-y-4 pt-3">{["Proyecto actualizado", "Archivos indexados", "Nuevo negocio creado"].map((item, index) => <div key={item} className="flex items-center gap-3"><div className="grid h-7 w-7 place-items-center rounded-lg bg-[#1c1c1c] text-[#777]"><CheckCircle2 size={14} /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-[#bbb]">{item}</div><div className="text-[10px] text-[#555]">Hace {index + 1} horas</div></div></div>)}</div></Panel>
        <Panel title="Tendencia" subtitle="Crecimiento promedio"><div className="flex h-full min-h-[150px] flex-col justify-between pt-4"><div className="flex items-end gap-2"><TrendingUp size={18} className="mb-1 text-[#86efac]" /><span className="text-3xl font-semibold tracking-tight text-[#eee]">+18.4%</span></div><div className="flex items-center gap-1 text-[11px] text-[#666]"><ArrowUpRight size={13} className="text-[#86efac]" /> 6.2% más que el período anterior</div><div className="mt-3 flex items-center gap-1 text-[10px] text-[#555]"><ArrowDownRight size={12} /> Datos estimados según actividad</div></div></Panel>
      </div>
    </div>
  </div>;
}

function DeveloperCard() {
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
