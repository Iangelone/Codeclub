'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { marketClient, confirmMarketEmail } from '../lib/market-cloud';
import { marketAccountTranslations, useAppLanguage } from '../lib/i18n';

export default function MarketAccount({ onUser }: { onUser: (user: User | null) => void }) {
  const text = marketAccountTranslations[useAppLanguage()];
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmationLink, setConfirmationLink] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'confirm'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  useEffect(() => {
    let active = true;
    const bridge = (window as any).codeclub;
    if (bridge && !bridge.marketAuthGet) { setRestartRequired(true); setReady(true); return; }
    const auth = marketClient().auth;
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      if (active) { setUser(session?.user || null); onUser(session?.user || null); setReady(true); }
    });
    void auth.getSession().then(({ data, error }) => {
      if (active) { setUser(data.session?.user || null); onUser(data.session?.user || null); setError(!!error); setReady(true); }
    }).catch(() => { if (active) { setError(true); setReady(true); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [onUser]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(false); setConfirmEmail(false);
    try {
      const auth = marketClient().auth;
      if (mode === 'confirm') {
        await confirmMarketEmail(confirmationLink);
        setConfirmationLink(''); setConfirmEmail(false); setMode('login');
        return;
      }
      const result = mode === 'register' ? await auth.signUp({ email: email.trim(), password }) : await auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        if (result.error.code === 'email_not_confirmed') { setMode('confirm'); setConfirmEmail(true); setPassword(''); return; }
        throw result.error;
      }
      setPassword('');
      if (mode === 'register' && !result.data.session) { setConfirmEmail(true); setMode('confirm'); }
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (busy || !email.trim()) return;
    setBusy(true); setError(false); setResendSent(false);
    try {
      const { error } = await marketClient().auth.resend({ type: 'signup', email: email.trim() });
      if (error) throw error;
      setResendSent(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true); setError(false);
    try { const { error } = await marketClient().auth.signOut({ scope: 'local' }); if (error) throw error; }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  const inputClass = 'h-8 min-w-0 rounded-md border border-[#2B2B2B] bg-[#161616] px-2.5 text-[12px] text-(--codeclub-text) outline-none';
  return <div className="mb-5 border-b border-[#202020] pb-4">
    {restartRequired ? <p role="status" className="text-[12px] text-(--codeclub-text-muted)">{text.restart}</p> : !ready ? <p role="status" className="text-[12px] text-(--codeclub-text-muted)">{text.loading}</p> : user ?
      <div className="flex items-center justify-between gap-3"><span className="truncate text-[12px] text-(--codeclub-text-muted)">{user.email}</span><button type="button" disabled={busy} onClick={() => { void signOut(); }} className="rounded-md px-2 py-1 text-[12px] text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) disabled:opacity-40">{text.signOut}</button></div> :
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <p className="m-0 w-full text-[12px] text-(--codeclub-text-muted)">{text.description}</p>
        <label className="grid gap-1 text-[11px] text-(--codeclub-text-muted)">{text.email}<input required type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label>
        {mode !== 'confirm' && <label className="grid gap-1 text-[11px] text-(--codeclub-text-muted)">{text.password}<input required type="password" minLength={8} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} className={inputClass} /></label>}
        {mode === 'confirm' && <label className="grid min-w-0 flex-1 gap-1 text-[11px] text-(--codeclub-text-muted)">{text.confirmationLink}<input required type="password" autoComplete="off" maxLength={4096} value={confirmationLink} disabled={busy} onChange={(event) => setConfirmationLink(event.target.value)} placeholder={text.confirmationPlaceholder} className={inputClass} /></label>}
        <button type="submit" disabled={busy} className="h-8 rounded-md bg-white px-3 text-[12px] text-[#111111] disabled:opacity-40">{busy ? text.working : mode === 'confirm' ? text.confirm : mode === 'login' ? text.signIn : text.register}</button>
        <button type="button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(false); setConfirmEmail(false); setConfirmationLink(''); setResendSent(false); }} className="h-8 rounded-md px-2 text-[12px] text-(--codeclub-text-muted) hover:bg-(--codeclub-hover)">{mode === 'login' ? text.register : text.signIn}</button>
        {mode === 'login' && <button type="button" disabled={busy} onClick={() => { setMode('confirm'); setError(false); setConfirmEmail(true); }} className="h-8 rounded-md px-2 text-[12px] text-(--codeclub-text-muted) hover:bg-(--codeclub-hover)">{text.confirm}</button>}
        {mode === 'confirm' && <button type="button" disabled={busy || !email.trim()} onClick={() => { void resend(); }} className="h-8 rounded-md px-2 text-[12px] text-(--codeclub-text-muted) hover:bg-(--codeclub-hover) disabled:opacity-40">{text.resend}</button>}
      </form>}
    {confirmEmail && <p role="status" className="mb-0 mt-2 text-[12px] text-(--codeclub-text-muted)">{text.confirmEmail}</p>}
    {resendSent && <p role="status" className="mb-0 mt-2 text-[12px] text-(--codeclub-text-muted)">{text.resendSent}</p>}
    {error && <p role="alert" className="mb-0 mt-2 text-[12px] text-red-300">{text.error}</p>}
  </div>;
}
