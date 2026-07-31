import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("Usuario");

  useEffect(() => {
    invoke<string>("codeclub_get_username").then(setUsername).catch(() => setUsername("Usuario"));
  }, []);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button className="absolute inset-0 cursor-default border-0 bg-black/65 backdrop-blur-[4px]" onClick={onClose} aria-label="Cerrar ajustes" />
      <div className="acrylic-panel relative w-[380px] max-w-[90vw] overflow-hidden rounded-[5%] shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 id="settings-title" className="text-lg font-semibold text-white">Ajustes</h2>
            <button onClick={onClose} className="rounded-md border-0 bg-transparent p-1 text-[#888] transition-colors hover:text-white" aria-label="Cerrar"><X size={18} /></button>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-[#e5e5e5]">{username}</p><p className="text-xs text-[#888]">Usuario de este equipo</p></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
