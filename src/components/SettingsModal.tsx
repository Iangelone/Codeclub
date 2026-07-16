import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Check, ImageIcon, PaintBucket, X } from "lucide-react";

const COLOR_PRESETS = [
  { hue: 0, name: "Rojo" },
  { hue: 25, name: "Naranja" },
  { hue: 50, name: "Ámbar" },
  { hue: 90, name: "Verde" },
  { hue: 140, name: "Esmeralda" },
  { hue: 185, name: "Cian" },
  { hue: 220, name: "Azul" },
  { hue: 260, name: "Violeta" },
  { hue: 295, name: "Magenta" },
  { hue: 330, name: "Rosa" },
];

const colorFromHue = (hue: number) => `hsl(${hue}, 55%, 45%)`;
const DEFAULT_COLOR = colorFromHue(220);

function applyBackground(type: "color" | "image", value: string) {
  document.body.style.backgroundImage = type === "image"
    ? `linear-gradient(rgba(10, 10, 10, 0.52), rgba(10, 10, 10, 0.52)), url("${value}")`
    : "none";
  document.body.style.backgroundColor = type === "color" ? value : "#111111";
}

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("Usuario");
  const [avatarColor, setAvatarColor] = useState(DEFAULT_COLOR);
  const [bgType, setBgType] = useState<"color" | "image">("image");
  const [bgValue, setBgValue] = useState("/unsplash.jpg");
  const [urlInput, setUrlInput] = useState("/unsplash.jpg");

  useEffect(() => {
    const savedColor = localStorage.getItem("codeclub_avatar_color") || DEFAULT_COLOR;
    const savedType = (localStorage.getItem("codeclub_background_type") || "image") as "color" | "image";
    const savedValue = localStorage.getItem("codeclub_background_value") || "/unsplash.jpg";
    setAvatarColor(savedColor);
    setBgType(savedType);
    setBgValue(savedValue);
    setUrlInput(savedType === "image" ? savedValue : "");
    applyBackground(savedType, savedValue);

    invoke<string>("codeclub_get_username").then(setUsername).catch(() => setUsername("Usuario"));
  }, []);

  const changeColor = (color: string) => {
    setAvatarColor(color);
    localStorage.setItem("codeclub_avatar_color", color);
    window.dispatchEvent(new CustomEvent("codeclub:profile-changed", { detail: { color } }));
  };

  const changeBackground = (type: "color" | "image", value: string) => {
    setBgType(type);
    setBgValue(value);
    localStorage.setItem("codeclub_background_type", type);
    localStorage.setItem("codeclub_background_value", value);
    applyBackground(type, value);
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button className="absolute inset-0 cursor-default border-0 bg-black/65 backdrop-blur-[4px]" onClick={onClose} aria-label="Cerrar ajustes" />
      <div className="relative w-[380px] max-w-[90vw] overflow-hidden rounded-[5%] border border-white/10 bg-[#161616]/90 shadow-[0_30px_60px_rgba(0,0,0,0.6)] backdrop-blur-[40px]">
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 id="settings-title" className="text-lg font-semibold text-white">Ajustes</h2>
            <button onClick={onClose} className="rounded-md border-0 bg-transparent p-1 text-[#888] transition-colors hover:text-white" aria-label="Cerrar"><X size={18} /></button>
          </div>

          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: avatarColor }}>{username.charAt(0).toUpperCase()}</div>
            <div className="min-w-0"><p className="truncate text-sm font-medium text-[#e5e5e5]">{username}</p><p className="text-xs text-[#888]">Usuario de este equipo</p></div>
          </div>

          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="mb-3 text-xs text-[#999]">Color de usuario</p>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(({ hue, name }) => { const color = colorFromHue(hue); const selected = avatarColor === color; return (
                <button key={hue} title={name} onClick={() => changeColor(color)} className={`grid h-6 w-6 place-items-center rounded-full border-0 transition-transform hover:scale-110 ${selected ? "ring-2 ring-white ring-offset-2 ring-offset-[#161616]" : ""}`} style={{ backgroundColor: color }} aria-label={`Color ${name}`}>
                  {selected && <Check size={12} className="text-white" />}
                </button>
              ); })}
            </div>
          </div>

          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="mb-3 text-xs text-[#999]">Fondo</p>
            <div className="mb-3 flex gap-2">
              <button onClick={() => changeBackground("color", "#101010")} className={`flex items-center gap-1.5 rounded-lg border-0 px-3 py-1.5 text-xs transition-colors ${bgType === "color" ? "bg-white/20 text-white" : "bg-white/5 text-[#999] hover:bg-white/10"}`}><PaintBucket size={13} /> Color plano</button>
              <button onClick={() => changeBackground("image", urlInput || "/unsplash.jpg")} className={`flex items-center gap-1.5 rounded-lg border-0 px-3 py-1.5 text-xs transition-colors ${bgType === "image" ? "bg-white/20 text-white" : "bg-white/5 text-[#999] hover:bg-white/10"}`}><ImageIcon size={13} /> Imagen</button>
            </div>
            {bgType === "image" && <div className="flex gap-2"><input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://..." className="min-w-0 flex-1 rounded-xl border-0 bg-[#1c1c1c] px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:ring-1 focus:ring-white/20" /><button onClick={() => changeBackground("image", urlInput || "/unsplash.jpg")} className="rounded-xl border-0 bg-white/10 px-3 py-2 text-xs text-white transition-colors hover:bg-white/20">Aplicar</button></div>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
