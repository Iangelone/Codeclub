'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export const ORB_PALETTE_STORAGE_KEY = 'codeclub:orb-palette-index';
export const ORB_PALETTE_EVENT = 'codeclub:orb-palette-change';

export const ORB_PALETTES = [
  { id: 'blue', es: 'Azul', en: 'Blue', orb: '#2D5FD6', accent: '#3D9BFF', bright: '#8BC7FF', electric: '#2F6BFF', hue: 0 },
  { id: 'red', es: 'Rojo', en: 'Red', orb: '#D63D52', accent: '#F04E65', bright: '#FFABB7', electric: '#E83A50', hue: 138 },
  { id: 'yellow', es: 'Amarillo', en: 'Yellow', orb: '#D6A317', accent: '#E8B930', bright: '#FFE08A', electric: '#E5AF23', hue: 180 },
  { id: 'violet', es: 'Violeta', en: 'Violet', orb: '#7543D6', accent: '#9C6AFF', bright: '#C1A5FF', electric: '#8352ED', hue: 38 },
  { id: 'green', es: 'Verde', en: 'Green', orb: '#21845A', accent: '#39B77C', bright: '#8FE6B9', electric: '#29A76A', hue: -70 },
  { id: 'orange', es: 'Naranja', en: 'Orange', orb: '#D6752B', accent: '#F0893A', bright: '#FFC092', electric: '#EA762B', hue: 166 },
  { id: 'pink', es: 'Rosa', en: 'Pink', orb: '#D64A9E', accent: '#F15BB9', bright: '#FFABD8', electric: '#E64FA9', hue: 100 },
  { id: 'cyan', es: 'Cian', en: 'Cyan', orb: '#228FAD', accent: '#31B4D5', bright: '#92E5F2', electric: '#2699BA', hue: -30 },
  { id: 'lime', es: 'Lima', en: 'Lime', orb: '#8CAB20', accent: '#B4D43A', bright: '#DBEF8D', electric: '#9AB930', hue: -144 },
] as const;

export type OrbPalette = (typeof ORB_PALETTES)[number];

type OrbPaletteContextValue = {
  palette: OrbPalette;
  nextPalette: OrbPalette;
  cyclePalette: () => void;
};

const OrbPaletteContext = createContext<OrbPaletteContextValue | null>(null);

function normalizeIndex(value: unknown) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < ORB_PALETTES.length ? index : 0;
}

function readStoredIndex() {
  try { return normalizeIndex(window.localStorage.getItem(ORB_PALETTE_STORAGE_KEY)); } catch { return 0; }
}

function colorWithAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function useOrbPalette() {
  const context = useContext(OrbPaletteContext);
  if (!context) throw new Error('useOrbPalette debe usarse dentro de OrbPaletteProvider.');
  return context;
}

export default function OrbPaletteProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const reducedMotion = useReducedMotion();

  const applyIndex = useCallback((value: unknown) => {
    const nextIndex = normalizeIndex(value);
    indexRef.current = nextIndex;
    setIndex(nextIndex);
  }, []);

  useEffect(() => {
    applyIndex(readStoredIndex());

    // Emisor: OrbPaletteButton persiste el índice y despacha el evento local.
    // Payload: { index: number }. Consumidores: este provider, en cada ventana renderer.
    // También recibe cambios de otras pestañas por storage y de otras ventanas por IPC.
    const onPaletteChange = (event: Event) => applyIndex((event as CustomEvent<{ index?: number }>).detail?.index);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ORB_PALETTE_STORAGE_KEY) applyIndex(event.newValue);
    };
    const onNativePaletteChange = (value: number) => {
      window.dispatchEvent(new CustomEvent(ORB_PALETTE_EVENT, { detail: { index: value } }));
    };
    const unsubscribeNative = (window as any).codeclub?.onOrbPaletteChange?.(onNativePaletteChange);
    window.addEventListener(ORB_PALETTE_EVENT, onPaletteChange);
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribeNative?.();
      window.removeEventListener(ORB_PALETTE_EVENT, onPaletteChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [applyIndex]);

  const cyclePalette = useCallback(() => {
    const nextIndex = (indexRef.current + 1) % ORB_PALETTES.length;
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    try { window.localStorage.setItem(ORB_PALETTE_STORAGE_KEY, String(nextIndex)); } catch { /* La sincronización nativa sigue disponible si falla el almacenamiento local. */ }
    window.dispatchEvent(new CustomEvent(ORB_PALETTE_EVENT, { detail: { index: nextIndex } }));
    (window as any).codeclub?.broadcastOrbPalette?.(nextIndex);
  }, []);

  const palette = ORB_PALETTES[index];
  const nextPalette = ORB_PALETTES[(index + 1) % ORB_PALETTES.length];
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.48, ease: [0.22, 1, 0.36, 1] as const };

  return <OrbPaletteContext.Provider value={{ palette, nextPalette, cyclePalette }}>
    <motion.div
      className="contents"
      initial={false}
      animate={{
        '--nexo-orb-blue': palette.orb,
        '--codeclub-accent': palette.accent,
        '--codeclub-accent-bright': palette.bright,
        '--codeclub-chat-glow': colorWithAlpha(palette.orb, 0.2),
        '--electric-blue': palette.electric,
        '--nexo-electric-blue': palette.electric,
      }}
      transition={transition}
    >
      {children}
    </motion.div>
  </OrbPaletteContext.Provider>;
}
