'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useAppLanguage } from '../../lib/i18n';
import { useOrbPalette } from '../OrbPaletteProvider';
import FluidOrb from './fluid-orb';

type OrbPaletteButtonProps = {
  size: number;
  className?: string;
  active?: boolean;
};

export default function OrbPaletteButton({ size, className = '', active }: OrbPaletteButtonProps) {
  const { nextPalette, cyclePalette } = useOrbPalette();
  const language = useAppLanguage();
  const reducedMotion = useReducedMotion();
  const targetName = language === 'en' ? nextPalette.en : nextPalette.es;
  const label = language === 'en'
    ? `Change all orbs to ${targetName}`
    : `Cambiar todos los orbes a ${targetName}`;

  return <motion.button
    type="button"
    className={`orb-palette-trigger ${className}`}
    style={{ width: size, height: size }}
    title={label}
    aria-label={label}
    onPointerDown={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.preventDefault()}
    onClick={cyclePalette}
    whileHover={reducedMotion ? undefined : { scale: 1.08 }}
    whileTap={reducedMotion ? undefined : { scale: 0.9 }}
    transition={{ type: 'spring', stiffness: 460, damping: 28 }}
  >
    <FluidOrb size={size} active={active} aria-hidden="true" />
  </motion.button>;
}
