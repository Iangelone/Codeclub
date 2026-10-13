/** Offline i18next runtime shared by the companion's screens. */
i18next.init({ resources: { en: { translation: codeclubMessages.en }, es: { translation: codeclubMessages.es } }, lng: 'en', fallbackLng: 'en', initAsync: false, interpolation: { escapeValue: false } });
globalThis.mobileMessages = (language) => {
  const locale = language === 'es' ? 'es' : 'en';
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
  return i18next.getResourceBundle(locale, 'translation');
};
