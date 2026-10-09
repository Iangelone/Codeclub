'use client';

import { useState } from 'react';
import { Check, Globe, Laptop, Monitor } from 'lucide-react';
import { orbWorkspaceTranslations, useAppLanguage } from '../lib/i18n';

/** First step of orb creation: a separate browser, with optional access to this device. */
export default function OrbWorkspaceSetup({ onContinue }: { onContinue: (allowComputer: boolean) => void }) {
  const text = orbWorkspaceTranslations[useAppLanguage()];
  const [allowComputer, setAllowComputer] = useState(false);
  return <div className="flex min-h-full w-full items-center justify-center bg-[#161616] px-5 py-7">
    <div className="w-full max-w-[320px]">
      <div aria-hidden="true" className="relative mx-auto mb-6 w-[205px] max-w-full pb-5">
        <div className="rounded-[15px] border border-[#d4dce6] bg-[#a7b5c9] p-3 shadow-lg">
          <div className="overflow-hidden rounded border border-[#8f9daf] bg-[#f6f8fa] text-[#718093]">
            <div className="flex h-4 items-center gap-1 bg-[#dce4ec] px-2"><span className="h-1 w-1 rounded-full bg-[#94a2b4]" /><span className="h-1 w-1 rounded-full bg-[#94a2b4]" /><span className="h-1 w-1 rounded-full bg-[#94a2b4]" /></div>
            <div className="flex h-5 items-center gap-2 border-b border-[#e4e8ed] px-2"><Globe size={8} /><div className="h-2 flex-1 rounded-full bg-white" /></div>
            <div className="flex h-[100px] flex-col items-center justify-center gap-2">
              <span className="text-[9px] font-medium">Codeclub</span>
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#dcecff]"><span className="h-4 w-4 rounded-full bg-[#8bc7ff]" /></div>
              <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, index) => <span key={index} className="h-2.5 w-2.5 rounded bg-[#e1e7ef]" />)}</div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-1/2 flex h-7 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-b-[15px] bg-[#a7b5c9] px-3 text-[9px] text-white"><Monitor size={14} />{text.workspace}</div>
      </div>
      <h1 className="m-0 text-center text-[20px] font-semibold leading-6 tracking-tight text-[#eeeeee]">{text.title}</h1>
      <p className="mt-1.5 text-center text-[12px] leading-4 text-[#aaaaaa]">{text.description}</p>
      <div className="mt-5 space-y-2.5">
        <div className="flex items-center gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#202020] text-[#cccccc]"><Monitor size={14} aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="m-0 text-[12px] font-medium text-[#eeeeee]">{text.workspace}</p><p className="m-0 mt-0.5 text-[11px] leading-4 text-[#aaaaaa]">{text.workspaceDescription}</p></div><Check size={14} className="shrink-0 text-[#eeeeee]" aria-hidden="true" /></div>
        <div className="flex items-center gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#202020] text-[#cccccc]"><Laptop size={14} aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="m-0 text-[12px] font-medium text-[#eeeeee]">{text.thisComputer}</p><p className="m-0 mt-0.5 text-[11px] leading-4 text-[#aaaaaa]">{text.computerDescription}</p></div><button type="button" role="switch" aria-checked={allowComputer} aria-label={text.thisComputer} title={text.thisComputer} onClick={() => setAllowComputer(value => !value)} className={`relative h-5 w-8 shrink-0 rounded-full border border-[#555555] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--codeclub-accent) ${allowComputer ? 'bg-[#eeeeee]' : 'bg-[#333333]'}`}><span className={`absolute top-0.5 h-[14px] w-[14px] rounded-full ${allowComputer ? 'left-[15px] bg-[#161616]' : 'left-0.5 bg-[#eeeeee]'}`} /></button></div>
      </div>
      <button type="button" onClick={() => onContinue(allowComputer)} className="mt-5 h-7 w-full rounded-full bg-[#eeeeee] px-4 text-[12px] font-medium text-[#161616] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--codeclub-accent)">{text.continue}</button>
    </div>
  </div>;
}
