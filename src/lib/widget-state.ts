/** Pure transition rule for floating-chat idle behavior; protected interactions never auto-hide. */
export type WidgetMode = 'compact' | 'expanded' | 'retracted';
export function idleWidgetMode(mode: WidgetMode, protectedInteraction: boolean, autoHide: boolean): WidgetMode {
  if (protectedInteraction || !autoHide) return mode;
  return mode==='expanded'?'compact':'retracted';
}
