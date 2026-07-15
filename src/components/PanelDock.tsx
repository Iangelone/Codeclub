import { ArrowLeftRight, House } from 'lucide-react';

type PanelDockProps = {
  onHome: () => void;
  visible: boolean;
  showSwap: boolean;
  onSwap: () => void;
  recentChats: Array<{ id: string; name: string }>;
  onOpenChat: (chat: { id: string; name: string }) => void;
};

export default function PanelDock({ onHome, visible, showSwap, onSwap, recentChats, onOpenChat }: PanelDockProps) {
  if (!visible) return null;

  return (
    <div className="group/panel-dock pointer-events-auto absolute left-1/2 top-0 z-30 flex h-[52px] w-auto -translate-x-1/2 items-start justify-center px-3 pt-3">
      <div className="pointer-events-none flex items-center rounded-full border border-[var(--color-surface-8)] bg-[rgba(18,18,18,0.82)] p-1 opacity-0 shadow-[0_10px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-150 ease-out group-hover/panel-dock:pointer-events-auto group-hover/panel-dock:translate-y-0 group-hover/panel-dock:opacity-100 -translate-y-1">
        <button
          type="button"
          onClick={onHome}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent text-[#bdbdbd] transition-colors hover:bg-[var(--color-surface-7)] hover:text-[#eeeeee] focus-visible:bg-[var(--color-surface-7)] focus-visible:text-[#eeeeee] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-surface-8)]"
          aria-label="Volver al selector de paneles"
          title="Volver al selector de paneles"
        >
          <House size={15} strokeWidth={1.8} />
        </button>
        {recentChats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => onOpenChat(chat)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent text-[11px] font-medium uppercase text-[#bdbdbd] transition-colors hover:bg-[var(--color-surface-7)] hover:text-[#eeeeee] focus-visible:bg-[var(--color-surface-7)] focus-visible:text-[#eeeeee] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-surface-8)]"
            aria-label={`Abrir chat ${chat.name}`}
            title={chat.name}
          >
            {chat.name.trim().charAt(0) || '?'}
          </button>
        ))}
        {showSwap && (
          <button
            type="button"
            onClick={onSwap}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-transparent text-[#bdbdbd] transition-colors hover:bg-[var(--color-surface-7)] hover:text-[#eeeeee] focus-visible:bg-[var(--color-surface-7)] focus-visible:text-[#eeeeee] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-surface-8)]"
            aria-label="Intercambiar paneles"
            title="Intercambiar paneles"
          >
            <ArrowLeftRight size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}
