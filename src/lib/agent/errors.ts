/** Configuration errors have stable identities independent of the displayed language. */
export class MissingModelCredentialError extends Error {
  readonly code = 'MODEL_CREDENTIAL_MISSING';
  constructor(message: string) { super(message); this.name = 'MissingModelCredentialError'; }
}
export const isMissingModelCredential = (error: unknown): error is MissingModelCredentialError => error instanceof MissingModelCredentialError;
