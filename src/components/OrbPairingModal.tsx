'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, LoaderCircle, RefreshCw, Smartphone, X } from 'lucide-react';
import { orbPairingTranslations, useAppLanguage } from '../lib/i18n';
import { nativeInvoke } from '../lib/runtime';
import { useDialogAccessibility } from './ui/use-accessible-overlay';

type Offer = { pairId: string; expiresAt: number; code: string; qr: string };
type Device = { deviceId: string; state: string };
/** Pairing secrets live only in this dialog; close invalidates unconsumed codes. */
export default function OrbPairingModal({ onClose }: { onClose: () => void }) {
  const text = orbPairingTranslations[useAppLanguage()];
  const dialog = useRef<HTMLDivElement>(null);
  const [offer, setOffer] = useState<Offer>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [paired, setPaired] = useState(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  useDialogAccessibility(dialog, true, onClose);
  const refresh = async () => {
    const current = ++sequence.current;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true); setError(''); setCopied(false); setPaired(false); setOffer(undefined);
    try {
      const next = await nativeInvoke<Offer>('codeclub_android_pairing_create', {});
      if (mounted.current && sequence.current === current) { setOffer(next); setSeconds(Math.max(0, Math.ceil((next.expiresAt - Date.now()) / 1000))); }
    } catch { if (mounted.current && sequence.current === current) setError(text.error); }
    finally { if (mounted.current && sequence.current === current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; sequence.current++; void nativeInvoke('codeclub_android_pairing_cancel', {}).catch(() => undefined); };
    // The offer must survive language switching without rotating the scanned secret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (offer) setSeconds(Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000)));
      try {
        const result = await nativeInvoke<{ devices: Device[]; paired: boolean }>('codeclub_android_pairing_status', { pairId: offer?.pairId });
        if (active) { setDevices(result.devices); setPaired(result.paired); }
      } catch { if (active) setError(text.error); }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [offer, text.error]);
  const copy = async () => {
    if (!offer || !seconds || paired) return;
    try { await navigator.clipboard.writeText(offer.code); setCopied(true); }
    catch { setError(text.copyError); }
  };
  const forget = async (deviceId: string) => {
    dialog.current?.focus({ preventScroll: true }); setBusy(true); setError('');
    try { await nativeInvoke('codeclub_android_pairing_forget', { deviceId }); setDevices(previous => previous.filter(device => device.deviceId !== deviceId)); }
    catch { setError(text.error); }
    finally { if (mounted.current) setBusy(false); }
  };
  const button = 'flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[12px] text-[#aaaaaa] hover:bg-[#1e1e1e] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
  return createPortal(<div className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/65 p-4 backdrop-blur-[3px]" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="orb-pairing-title" aria-describedby="orb-pairing-hint" tabIndex={-1} className="relative flex max-h-[90vh] w-full max-w-[380px] flex-col overflow-hidden rounded-[20px] border border-[#202020] bg-[#111111] text-[#eeeeee] shadow-2xl shadow-black/60">
      <header className="px-5 py-4 pr-12"><h2 id="orb-pairing-title" className="m-0 text-[14px] font-medium">{text.title}</h2></header>
      <button type="button" onClick={onClose} aria-label={text.close} title={text.close} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-[#999999] hover:bg-[#1e1e1e] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><X size={15} aria-hidden="true"/></button>
      <div className="min-h-0 overflow-y-auto px-5 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p id="orb-pairing-hint" className="m-0 text-[12px] leading-5 text-[#999999]">{text.hint}</p>
        <div className="my-5 grid min-h-[240px] place-items-center">
          {busy ? <LoaderCircle className="animate-spin text-[#888888]" size={22} aria-label={text.loading}/> : paired ? <div role="status" className="flex flex-col items-center gap-3 text-[13px]"><Check size={28} className="text-[#8bc7ff]"/>{text.paired}</div> : offer && seconds > 0 ? <img src={offer.qr} width={240} height={240} alt={text.qrAlt} className="rounded-xl bg-white p-2"/> : <p role="status" className="text-[12px] text-[#999999]">{offer ? text.expired : text.unavailable}</p>}
        </div>
        {offer && !paired && seconds > 0 && <p className="m-0 text-center text-[11px] text-[#777777]">{text.expires} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>}
        <div className="mt-3 flex justify-center gap-2"><button type="button" onClick={() => void copy()} disabled={busy || !offer || seconds === 0 || paired} className={button}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? text.copied : text.copy}</button><button type="button" onClick={() => void refresh()} disabled={busy} className={button} title={text.refresh} aria-label={text.refresh}><RefreshCw size={14} aria-hidden="true"/>{text.refresh}</button></div>
        {!!devices.length && <div className="mt-5 overflow-hidden rounded-xl border border-[#202020]">{devices.map((device, index) => <div key={device.deviceId} className="flex h-11 items-center gap-2 px-3 text-[12px]"><Smartphone size={14} aria-hidden="true" className="text-[#999999]"/><span className="flex-1">Android{devices.length > 1 ? ` ${index + 1}` : ''}</span><span className="text-[11px] text-[#888888]">{device.state === 'device' ? text.connected : text.offline}</span><button type="button" disabled={busy} onClick={() => void forget(device.deviceId)} className="grid h-7 w-7 place-items-center rounded-lg text-[#888888] hover:bg-[#1e1e1e] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)" aria-label={text.forget} title={text.forget}><X size={13} aria-hidden="true"/></button></div>)}</div>}
        {error && <p role="alert" className="mt-3 text-[11px] leading-5 text-[#ffb4b4]">{error}</p>}
        <p className="mb-0 mt-5 text-center text-[11px] leading-5 text-[#777777]">{text.private}</p>
      </div>
    </div>
  </div>, document.body);
}
