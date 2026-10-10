'use client';

import { useEffect, useMemo } from 'react';
import ChatInterface from './ChatInterface';
import type { OrbDefinition } from '../lib/chat-resources';
import { models, providers } from '../lib/ai-catalog';
import { modelIdFor, modelMatchesProvider } from '../lib/ai-routing';

/** Open an isolated orb conversation through the existing chat engine and history store. */
export default function OrbAgentChat({ orb }: { orb: OrbDefinition }) {
  const provider = providers.find(item => item.id === orb.providerId) || providers[0];
  const model = models.find(item => modelMatchesProvider(item, provider) && modelIdFor(provider, item) === orb.modelId) || models.find(item => modelMatchesProvider(item, provider));
  const catalog = useMemo(() => [...providers.map(item => ({ ...item, type: 'provider' })), ...models.map(item => ({ ...item, type: 'model' }))], []);
  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('codeclub:orb-agent:open-chat', { detail: { chatId: orb.chatId || `orb-chat-${orb.id}`, projectPath: '', name: orb.name, customName: true } })), 0);
    return () => window.clearTimeout(timer);
  }, [orb.id, orb.chatId]);
  if (!provider || !model) return null;
  return <div className="h-full min-h-0 overflow-hidden"><ChatInterface catalog={catalog as any} defaultProvider={provider as any} defaultModel={model as any} panelId={`orb-${orb.id}`} eventPrefix="codeclub:orb-agent" agentOrb={orb} /></div>;
}
