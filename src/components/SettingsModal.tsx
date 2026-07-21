import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Check, X } from "lucide-react";
import { getSetting, setSetting } from "../lib/persistence";

const COLOR_PRESETS = [
  { color: "#C7CBFF", name: "Lavanda" },
  { color: "#7DD3FC", name: "Celeste" },
  { color: "#86EFAC", name: "Verde" },
  { color: "#FDE68A", name: "Amarillo" },
  { color: "#F9A8D4", name: "Rosa" },
  { color: "#D8B4FE", name: "Violeta" },
];

const DEFAULT_COLOR = COLOR_PRESETS[0].color;

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("Usuario");
  const [avatarColor, setAvatarColor] = useState(DEFAULT_COLOR);

  useEffect(() => {
    getSetting("codeclub_avatar_color", DEFAULT_COLOR).then(setAvatarColor);
    invoke<string>("codeclub_get_username").then(setUsername).catch(() => setUsername("Usuario"));
  }, []);

  const changeColor = (color: string) => {
    setAvatarColor(color);
    void setSetting("codeclub_avatar_color", color);
    window.dispatchEvent(new CustomEvent("codeclub:profile-changed", { detail: { color } }));
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
            <div className="min-w-0"><p className="truncate text-sm font-medium text-[#e5e5e5]">{username}</p><p className="text-xs text-[#888]">Usuario de este equipo</p></div>
          </div>
          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="mb-3 text-xs text-[#999]">Color de usuario</p>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(({ color, name }) => { const selected = avatarColor === color; return (
                <button key={color} title={name} onClick={() => changeColor(color)} className={`grid h-6 w-6 place-items-center rounded-full border-0 transition-transform hover:scale-110 ${selected ? "ring-2 ring-white ring-offset-2 ring-offset-[#161616]" : ""}`} style={{ backgroundColor: color }} aria-label={`Color ${name}`}>
                  {selected && <Check size={12} className="text-white" />}
                </button>
              ); })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
