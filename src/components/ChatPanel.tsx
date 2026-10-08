'use client';

import { memo } from 'react';
import WorkspaceManager from './WorkspaceManager';
import { models, providers } from '../lib/ai-catalog';

const defaultProvider = providers[0] ?? null;
const defaultModel = defaultProvider ? (models.find((model: any) => model.providerId === defaultProvider.id) ?? null) : null;
// ChatInterface groups these entries by `type` in the command menu. Keep the
// catalog flat so provider and model commands remain discoverable.
const catalog = [
  ...providers.map((provider: any) => ({ ...provider, type: 'provider' })),
  ...models.map((model: any) => ({ ...model, type: 'model' })),
];

function ChatPanel() {
  return <section id="codeclub-chat-panel" className="relative h-full min-w-0 min-h-0 grid place-items-stretch overflow-hidden" aria-label="Chat"><WorkspaceManager catalog={catalog} defaultProvider={defaultProvider} defaultModel={defaultModel} /></section>;
}

export default memo(ChatPanel);
