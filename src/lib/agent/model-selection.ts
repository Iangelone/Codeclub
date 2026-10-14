import { credentialKeyFor, credentialTargetFor, usesGateway } from '../ai-routing';
import { getSetting } from '../persistence';
import type { ModelProvider, SelectedModel } from './model-client';

/** The picker receives credential readiness, never a secret or SDK provider instance. */
export async function resolveCredentialRequirement<T extends ModelProvider>(provider: T, model: SelectedModel | null) {
  const required = provider.id !== 'custom' && (usesGateway(provider, model) || provider.requiresApiKey !== false);
  const credential = required ? await getSetting(credentialKeyFor(provider, model), '') : '';
  return { required, missing: required && (!credential || credential === 'dummy-key'), target: credentialTargetFor(provider, model) };
}
