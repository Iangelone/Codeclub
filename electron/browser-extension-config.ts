/** Exact companion identities: unpacked Chromium key and Microsoft Edge Add-ons signing ID. */
export const EDGE_EXTENSION_ID = 'bomojefgeconjddklieajpeimnjkkbbb';
export const EDGE_EXTENSION_URL = `https://microsoftedge.microsoft.com/addons/detail/codeclub-browser-control/${EDGE_EXTENSION_ID}`;
export const COMPANION_EXTENSION_IDS = ['pomkkenhcjkfjdabdhogladflacafopd', EDGE_EXTENSION_ID] as const;
export const companionOriginAllowed = (origin: string) => COMPANION_EXTENSION_IDS.some(id => origin === `chrome-extension://${id}`);
export const edgeExtensionPage = (action: 'install' | 'uninstall') => action === 'install' ? EDGE_EXTENSION_URL : `edge://extensions/?id=${EDGE_EXTENSION_ID}`;
