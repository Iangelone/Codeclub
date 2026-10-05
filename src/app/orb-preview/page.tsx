'use client';
import FluidOrb from '../../components/ui/fluid-orb';

export default function OrbPreviewPage() {
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#111' }}>
    <FluidOrb size={180} color="#2D5FD6" animateOnHover={false} />
  </main>;
}
