import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

type Encryption = { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
/** Separate from the AI credential vault: only Supabase's session storage is readable. */
export class MarketSessionStore {
  private file: string;
  constructor(directory: string, private encryption: Encryption) {
    mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'market-session.encrypted');
  }
  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    if (!this.encryption.isEncryptionAvailable()) throw new Error('Session encryption unavailable');
    return JSON.parse(this.encryption.decryptString(readFileSync(this.file)));
  }
  private validate(key: string) {
    if (!/^codeclub-market-auth(?:-user|-code-verifier)?$/.test(key)) throw new Error('Invalid session key');
  }
  get(key: string): string | null { this.validate(key); return this.read()[key] ?? null; }
  set(key: string, value: string | null): void {
    this.validate(key);
    if (value !== null && (typeof value !== 'string' || value.length > 65536)) throw new Error('Invalid session value');
    if (!this.encryption.isEncryptionAvailable()) throw new Error('Session encryption unavailable');
    const entries = this.read();
    if (value === null) delete entries[key]; else entries[key] = value;
    const temp = this.file + '.tmp';
    writeFileSync(temp, this.encryption.encryptString(JSON.stringify(entries)));
    renameSync(temp, this.file);
  }
}
