import i18next from 'i18next';
import en from './en.js';
import es from './es.js';

const instance = i18next.createInstance();
void instance.init({ resources: { en: { translation: en }, es: { translation: es } }, lng: 'es', fallbackLng: 'en', initAsync: false, interpolation: { escapeValue: false } });
type Key = { [N in keyof typeof en]: `${N}.${keyof typeof en[N] & string}` }[keyof typeof en];
export function nativeText(key: Key, language?: string): string {
  return instance.t(key, { lng: language === undefined ? instance.language : language === 'en' ? 'en' : 'es' }) as string;
}
export function setNativeLanguage(language: unknown): void {
  void instance.changeLanguage(language === 'en' ? 'en' : 'es');
}
