import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { en, es } from './resources';

export type AppLanguage = 'en' | 'es';
export const LANGUAGE_STORAGE_KEY = 'codeclub-language';
type LanguageBridge = {
  settingsGet?: (key: string) => Promise<unknown>;
  settingsSet?: (key: string, value: unknown) => Promise<unknown>;
  onSettingsChanged?: (listener: (detail: { key: string }) => void) => (() => void);
};
const languageBridge = () => (window as unknown as { codeclub?: LanguageBridge }).codeclub;
let revision = 0;
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: 'es', fallbackLng: 'en', supportedLngs: ['en', 'es'],
  initAsync: false, interpolation: { escapeValue: false },
  react: { useSuspense: false }, returnNull: false,
});

type MessagePath<T> = { [K in keyof T & string]: T[K] extends string ? K : T[K] extends readonly unknown[] ? never : T[K] extends object ? `${K}.${MessagePath<T[K]>}` : never }[keyof T & string];
export type TranslationKey = MessagePath<typeof en>;

export function translate(key: TranslationKey, language: AppLanguage = getAppLanguage(), values: Record<string, unknown> = {}): string {
  return i18n.t(key, { ...values, lng: language }) as string;
}

export function getMessages<N extends keyof typeof en>(namespace: N, language: AppLanguage = getAppLanguage()): typeof en[N] {
  return i18n.getResourceBundle(language, 'translation')[namespace] ?? en[namespace];
}

export function getAppLanguage(): AppLanguage {
  if (typeof window !== 'undefined') {
    try { return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'es'; } catch { /* Storage may be unavailable. */ }
  }
  return i18n.language === 'en' ? 'en' : 'es';
}

export function setAppLanguage(language: AppLanguage): void {
  if (typeof window === 'undefined') return;
  revision++;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Keep the current window usable. */ }
  window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language } }));
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  void languageBridge()?.settingsSet?.(LANGUAGE_STORAGE_KEY, language).catch(() => undefined);
}

let subscribers = 0;
let removeListeners: (() => void) | undefined;
function subscribeLanguage(): () => void {
  if (subscribers++ === 0) {
    let active = true;
    const apply = (language: AppLanguage) => {
      try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Use the in-memory language. */ }
      void i18n.changeLanguage(language);
      document.documentElement.lang = language;
    };
    const onChange = (event: Event) => {
      const language = (event as CustomEvent<{ language?: AppLanguage }>).detail?.language;
      if (language === 'en' || language === 'es') { revision++; apply(language); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) { revision++; apply(event.newValue === 'en' ? 'en' : 'es'); }
    };
    window.addEventListener('codeclub:language-change', onChange);
    window.addEventListener('storage', onStorage);
    apply(getAppLanguage());
    const bridge = languageBridge();
    const readNativeLanguage = async () => {
      const requestedRevision = ++revision;
      try {
        const stored = await bridge?.settingsGet?.(LANGUAGE_STORAGE_KEY);
        if (!active || requestedRevision !== revision) return;
        if (stored === 'en' || stored === 'es') apply(stored);
        else if (bridge?.settingsSet) await bridge.settingsSet(LANGUAGE_STORAGE_KEY, getAppLanguage());
      } catch { /* Local preference works even while the native bridge is unavailable. */ }
    };
    if (bridge?.settingsGet) void readNativeLanguage();
    // Native SettingsStore emits { key }; every renderer synchronizes its own i18next instance.
    const unsubscribeNative = bridge?.onSettingsChanged?.(({ key }) => {
      if (key === LANGUAGE_STORAGE_KEY) void readNativeLanguage();
    });
    removeListeners = () => {
      active = false;
      unsubscribeNative?.();
      window.removeEventListener('codeclub:language-change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }
  return () => { if (--subscribers === 0) { removeListeners?.(); removeListeners = undefined; } };
}

export function useAppLanguage(): AppLanguage {
  const { i18n: instance } = useTranslation(undefined, { i18n });
  useEffect(subscribeLanguage, []);
  return instance.language === 'en' ? 'en' : 'es';
}
