'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Smartphone, X } from 'lucide-react';
import { orbCredentialsTranslations, useAppLanguage } from '../lib/i18n';
import { nativeInvoke } from '../lib/runtime';
import { useDialogAccessibility } from './ui/use-accessible-overlay';

type Device = { deviceId: string; state: string };

/** Configure native secrets without exposing saved values to the renderer or model. */
export default function OrbCredentialsModal({ onClose }: { onClose: () => void }) {
  const text = orbCredentialsTranslations[useAppLanguage()];
  const dialogRef = useRef<HTMLFormElement>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useDialogAccessibility(dialogRef, true, onClose);
  useEffect(() => {
    let active = true;
    void nativeInvoke<{ok: boolean; devices?: Device[]}>('codeclub_android_list_devices', {request:{}}).then(result => {
      if (!active) return;
      if (!result.ok) throw new Error('ANDROID_DISCOVERY_FAILED');
      const connected = result.devices?.filter(device => device.state === 'device') || [];
      setDevices(connected);
      if (connected.length === 1) setDeviceId(connected[0].deviceId);
    }).catch(() => { if (active) setError('load'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setSaved(false); setPin('');
    if (!deviceId) return;
    setStatusLoading(true);
    void nativeInvoke<{saved: boolean}>('codeclub_android_pin_status', {request:{deviceId}}).then(result => { if (active) setSaved(result.saved); }).catch(() => { if (active) setError('load'); }).finally(() => { if (active) setStatusLoading(false); });
    return () => { active = false; };
  }, [deviceId]);
  const save = async (remove = false) => {
    if (!deviceId || busy || statusLoading) return;
    if (!remove && !/^\d{4,16}$/.test(pin)) { setError('invalid'); return; }
    // Keep focus in the dialog when the submit/remove control becomes disabled or disappears.
    dialogRef.current?.focus({preventScroll:true});
    setBusy(true); setError('');
    try {
      await nativeInvoke('codeclub_android_pin_save', {request:{deviceId, pin:remove ? '' : pin}});
      setPin(''); setSaved(!remove);
    } catch { setError('save'); }
    finally { setBusy(false); }
  };
  const button = 'h-8 rounded-lg px-3 text-[12px] text-[#aaaaaa] hover:bg-[#1e1e1e] hover:text-[#eeeeee] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)';
  return createPortal(<div className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/65 p-4 backdrop-blur-[3px]" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="orb-credentials-title" tabIndex={-1} onSubmit={event => { event.preventDefault(); void save(); }} className="relative flex max-h-[90vh] w-full max-w-[420px] flex-col overflow-hidden rounded-[20px] border border-[#202020] bg-[#111111] text-[#eeeeee] shadow-2xl shadow-black/60">
      <header className="flex items-center px-5 py-4 pr-12"><h2 id="orb-credentials-title" className="m-0 text-[14px] font-medium">{text.title}</h2></header>
      <button type="button" onClick={onClose} aria-label={text.close} title={text.close} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-[#999999] hover:bg-[#1e1e1e] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent)"><X size={15} aria-hidden="true"/></button>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading ? <p role="status" className="m-0 text-[12px] text-[#999999]">{text.loading}</p> : !devices.length ? <p className="m-0 text-[12px] leading-5 text-[#999999]">{text.connect}</p> : <>
          {devices.length > 1 && <p className="m-0 text-[11px] text-[#999999]">{text.choose}</p>}
          <div className="overflow-hidden rounded-xl border border-[#202020]">{devices.map((device, index) => <button key={device.deviceId} type="button" disabled={busy} aria-pressed={deviceId === device.deviceId} onClick={() => { setError(''); setDeviceId(device.deviceId); }} className={`flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] hover:bg-[#191919] focus-visible:outline-2 focus-visible:outline-(--codeclub-accent) ${deviceId === device.deviceId ? 'bg-[#161616]' : ''}`}><Smartphone size={14} aria-hidden="true" className="text-[#999999]"/><span className="flex-1">{text.android}{devices.length > 1 ? ` ${index + 1}` : ''}</span>{deviceId === device.deviceId && saved && <span role="status" className="flex items-center gap-1.5 text-[11px] text-[#999999]"><CheckCircle2 size={12} aria-hidden="true"/>{text.saved}</span>}</button>)}</div>
          {deviceId && <><label className="block"><span className="mb-1.5 block text-[11px] text-[#aaaaaa]">{text.pin}</span><input type="password" inputMode="numeric" autoComplete="off" maxLength={16} value={pin} onChange={event => { setPin(event.target.value); setError(''); }} disabled={busy || statusLoading} placeholder={saved ? text.replace : text.empty} aria-describedby="orb-pin-hint" className="h-10 w-full rounded-xl border border-[#2b2b2b] bg-[#161616] px-3 text-[12px] text-[#eeeeee] outline-none placeholder:text-[#666666] focus:border-(--codeclub-accent)"/></label><p id="orb-pin-hint" className="m-0 text-[11px] leading-5 text-[#888888]">{text.hint}</p></>}
        </>}
        {error && <p role="alert" className="m-0 text-[11px] text-[#ffb4b4]">{error === 'invalid' ? text.invalid : text.error}</p>}
      </div>
      <footer className="flex items-center justify-end gap-1 border-t border-[#202020] px-4 py-3">{saved && <button type="button" onClick={() => void save(true)} disabled={busy || statusLoading} className={`${button} mr-auto`}>{text.remove}</button>}<button type="button" onClick={onClose} className={button}>{text.cancel}</button><button type="submit" disabled={!deviceId || !pin || busy || loading || statusLoading} className={`${button} bg-[#1e1e1e] text-[#eeeeee]`}>{busy ? text.saving : text.save}</button></footer>
    </form>
  </div>, document.body);
}
