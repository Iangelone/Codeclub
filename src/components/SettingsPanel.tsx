import React, { useEffect, useState } from 'react';
import { Keyboard, Monitor, Palette, UserRound } from 'lucide-react';
import { nativeInvoke as invoke } from '../lib/runtime';
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';

export default function SettingsPanel() {
  const [username, setUsername] = useState('Usuario');
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'workspace' | 'shortcuts'>('general');
  const [language, setLanguage] = useState<AppLanguage>('es');
  const text = language === 'en' ? { title: 'Settings', description: 'Configure Codeclub to work your way.', categories: 'Settings categories', general: 'General', appearance: 'Appearance', workspace: 'Workspace', shortcuts: 'Shortcuts', localProfile: 'Local profile', localUser: 'user on this computer', language: 'Language', interfaceLanguage: 'Interface language', appearanceSoon: 'Soon you will be able to configure the appearance of Codeclub.', workspaceSoon: 'Soon you will be able to configure workspace behavior.', shortcutsSoon: 'Soon you will be able to configure keyboard shortcuts.' } : { title: 'Ajustes', description: 'Configurá Codeclub para trabajar a tu manera.', categories: 'Categorías de ajustes', general: 'General', appearance: 'Apariencia', workspace: 'Workspace', shortcuts: 'Atajos', localProfile: 'Perfil local', localUser: 'usuario de este equipo', language: 'Idioma', interfaceLanguage: 'Idioma de la interfaz', appearanceSoon: 'Próximamente vas a poder configurar la apariencia de Codeclub.', workspaceSoon: 'Próximamente vas a poder configurar el comportamiento del workspace.', shortcutsSoon: 'Próximamente vas a poder configurar los accesos rápidos.' };

  const changeLanguage = (nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: nextLanguage } }));
  };

  useEffect(() => {
    if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') setLanguage('en');
    invoke<string>('codeclub_get_username').then(setUsername).catch(() => setUsername('Usuario'));
  }, []);

  return (
    <main className="file-preview-scrollbar h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[#1A1A1A]">
      <div className="mx-auto min-w-0 w-full max-w-[1040px] px-6 py-7 lg:px-8">
        <header>
          <h1 className="m-0 text-[28px] font-normal tracking-[-0.04em] text-[#eeeeee]">{text.title}</h1>
          <p className="mt-1.5 text-[14px] text-[#999999]">Configurá Codeclub para trabajar a tu manera.</p>
        </header>

        <nav className="file-preview-scrollbar mt-8 flex items-center gap-0.5 overflow-x-auto text-[13px] text-[#777777]" aria-label={text.categories}>
            {[
              ['general', text.general, UserRound],
              ['appearance', text.appearance, Palette],
              ['workspace', text.workspace, Monitor],
              ['shortcuts', text.shortcuts, Keyboard],
            ].map(([id, label, Icon]) => <button key={id as string} type="button" onClick={() => setActiveTab(id as typeof activeTab)} className={`flex shrink-0 items-center gap-2 rounded-[8px] border-0 px-3 py-1.5 transition-colors ${activeTab === id ? 'bg-[#2b2b2b] text-[#eeeeee]' : 'bg-transparent text-[#777777] hover:bg-[#202020] hover:text-[#eeeeee]'}`}><Icon size={15} strokeWidth={1.7} />{label as string}</button>)}
        </nav>

        <section className="mt-9 grid min-w-0 gap-3" aria-label={`${text.title}: ${activeTab}`}>
          {activeTab === 'general' && <>
            <div className="rounded-xl border border-[#2b2b2b] bg-[#202020] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: '#3D9BFF' }}><UserRound size={19} strokeWidth={0} fill="currentColor" /></div>
                <div className="min-w-0"><h2 className="m-0 text-[14px] font-medium text-[#eeeeee]">{text.localProfile}</h2><p className="mt-1 truncate text-[12px] text-[#888888]">{username} · {text.localUser}</p></div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-4 border-t border-[#2b2b2b] pt-4">
                <div><h3 className="m-0 text-[12px] font-medium text-[#dddddd]">{text.language}</h3><p className="mt-1 text-[11px] text-[#777777]">{text.interfaceLanguage}</p></div>
                <div className="relative grid grid-cols-2 rounded-[9px] border border-[#343434] bg-[#1A1A1A] p-1">
                  <span aria-hidden="true" className="pointer-events-none absolute bottom-1 left-1 top-1 w-[64px] rounded-[6px] bg-[#2b2b2b] transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: language === 'en' ? 'translateX(64px)' : 'translateX(0)' }} />
                  <button type="button" aria-pressed={language === 'es'} onClick={() => changeLanguage('es')} className={`relative z-10 w-[64px] rounded-[6px] border-0 bg-transparent px-2.5 py-1 text-[11px] transition-colors ${language === 'es' ? 'text-[#eeeeee]' : 'text-[#777777] hover:text-[#eeeeee]'}`}>Español</button>
                  <button type="button" aria-pressed={language === 'en'} onClick={() => changeLanguage('en')} className={`relative z-10 w-[64px] rounded-[6px] border-0 bg-transparent px-2.5 py-1 text-[11px] transition-colors ${language === 'en' ? 'text-[#eeeeee]' : 'text-[#777777] hover:text-[#eeeeee]'}`}>English</button>
                </div>
              </div>
            </div>
          </>}
          {activeTab === 'appearance' && <SettingsPlaceholder description={text.appearanceSoon} />}
          {activeTab === 'workspace' && <SettingsPlaceholder description={text.workspaceSoon} />}
          {activeTab === 'shortcuts' && <SettingsPlaceholder description={text.shortcutsSoon} />}
        </section>
      </div>
    </main>
  );
}

function SettingsPlaceholder({ description }: { description: string }) {
  return <div className="rounded-xl border border-[#2b2b2b] bg-[#202020] p-4"><p className="m-0 text-[13px] text-[#888888]">{description}</p></div>;
}
