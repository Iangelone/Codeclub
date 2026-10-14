/** The only renderer module allowed to read the Electron preload surface. */
import type { DesktopBridge } from '../../shared/desktop-contracts';
export type { DesktopBridge } from '../../shared/desktop-contracts';
export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { codeclub?: DesktopBridge }).codeclub;
}
export function requireDesktopBridge(): DesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return bridge;
}
