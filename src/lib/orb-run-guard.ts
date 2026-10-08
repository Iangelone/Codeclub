/** Per-cycle limits. Tool outputs are evidence, never instructions. */
export class OrbRunGuard {
  private attempts = new Map<string, number>();
  private results = new Map<string, { signature: string; repeats: number }>();
  private calls = 0;
  private stable(value: unknown): string {
    return JSON.stringify(value, (key, item) => ['snapshotId', 'at', 'createdAt', 'durationMs', 'agentGuidance'].includes(key) ? undefined : typeof item === 'string' ? item.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<snapshot>') : item);
  }
  before(name: string, input: unknown) {
    if (++this.calls > 48) throw new Error('TASK_BUDGET_EXCEEDED');
    if (/get|read|state|inspect|verify|check|test|search|list/i.test(name)) return;
    const signature = name + this.stable(input);
    const attempts = (this.attempts.get(signature) || 0) + 1;
    this.attempts.set(signature, attempts);
    if (attempts > 3) throw new Error('TASK_NO_PROGRESS');
  }
  after(name: string, input: unknown, output: unknown) {
    const signature = name + this.stable(input) + this.stable(output);
    const key = name + this.stable(input);
    const previous = this.results.get(key);
    const repeats = previous?.signature === signature ? previous.repeats + 1 : 1;
    this.results.set(key, { signature, repeats });
    if (repeats >= 3) throw new Error('TASK_NO_PROGRESS');
  }
}
