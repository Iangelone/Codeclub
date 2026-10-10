'use client';

import { useEffect } from 'react';
import { getSetting } from '../lib/persistence';
import { ORBS_STORAGE_KEY, parseOrbs } from '../lib/chat-resources';
import { models, providers } from '../lib/ai-catalog';
import { credentialKeyFor, modelIdFor, modelMatchesProvider, usesGateway } from '../lib/ai-routing';
import { nativeInvoke } from '../lib/runtime';
import { useAppLanguage } from '../lib/i18n';

/** Send fixed surface identifiers and credential readiness; never inspect editable controls. */
export default function OrbActivityObserver() {
  const language = useAppLanguage();
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const observe = async () => {
      if (!mounted || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const orbs = parseOrbs(await getSetting(ORBS_STORAGE_KEY, []));
        const ready: string[] = [];
        for (const orb of orbs.filter(orb => orb.maximumAutonomy === true)) {
          const provider = providers.find(item => item.id === orb.providerId);
          const model = provider && models.find(item => modelMatchesProvider(item, provider) && modelIdFor(provider, item) === orb.modelId);
          if (!provider || !model) continue;
          const needsKey = provider.id !== 'custom' && (usesGateway(provider, model) || provider.requiresApiKey !== false);
          if (!needsKey || await (window as any).codeclub?.credentialPresent(credentialKeyFor(provider, model))) ready.push(orb.id);
        }
        const section = document.getElementById('codeclub-main-content')?.getAttribute('data-surface');
        const surface = section === 'orbs' ? 'orb' : section === 'extensions' ? 'extensions' : section === 'tasks' ? 'tasks' : section === 'new-chat' ? 'chat' : 'home';
        if (mounted) await nativeInvoke('codeclub_orb_observe', { surface, ready, language });
      } catch { /* Observation failure must not interrupt normal app interaction. */ }
      finally { pending = false; }
    };
    void observe();
    const timer = window.setInterval(() => void observe(), 30000);
    window.addEventListener('codeclub:orbs-changed', observe);
    window.addEventListener('codeclub:settings-changed', observe);
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener('codeclub:orbs-changed', observe); window.removeEventListener('codeclub:settings-changed', observe); };
  }, [language]);
  return null;
}
