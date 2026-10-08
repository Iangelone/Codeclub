'use client';
/** Isolated palette/orb preview route for visual tuning; the main workspace is not mounted here. */
import OrbPaletteButton from '../../components/ui/OrbPaletteButton';

export default function OrbPreviewPage() {
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at 30% 110%, var(--codeclub-chat-glow), transparent 55%), #111315' }}>
    <OrbPaletteButton size={180} />
  </main>;
}
