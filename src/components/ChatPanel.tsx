'use client';

import WorkspaceManager from './WorkspaceManager';
import { models, providers } from '../lib/ai-catalog';

const defaultProvider = providers[0] ?? null;
const defaultModel = defaultProvider ? (models.find((model: any) => model.providerId === defaultProvider.id) ?? models[0] ?? null) : null;
const catalog = providers.map((provider: any) => ({ ...provider, models: models.filter((model: any) => model.providerId === provider.id) }));

export default function ChatPanel() {
  return <section className="relative h-full min-w-0 min-h-0 grid place-items-stretch overflow-hidden" aria-label="Chat"><WorkspaceManager catalog={catalog} defaultProvider={defaultProvider} defaultModel={defaultModel} /></section>;
}
