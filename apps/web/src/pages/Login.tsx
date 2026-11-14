import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Logo } from '../components/layout';
import { Field } from '../components/ui';
import { LOCALES, useI18n } from '../i18n';
import { authRequest } from '../lib/api';
import { errorText } from '../lib/toast';

export function Login({ error }: { error?: unknown }) {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', orgName: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error ? errorText(t, error) : null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await authRequest(mode, mode === 'login' ? { email: form.email, password: form.password } : form);
      await qc.invalidateQueries();
    } catch (x) {
      setErr(errorText(t, x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="splash">
      <form className="splash-card panel" style={{ padding: 28 }} onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <Logo size={40} />
          <div className="grow">
            <h1>Omborchi</h1>
            <p className="muted">{t('auth.tagline')}</p>
          </div>
          <select className="select" style={{ width: 'auto' }} value={locale} onChange={(e) => setLocale(e.target.value as never)} aria-label={t('common.language')}>
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <h2>{mode === 'login' ? t('auth.signIn') : t('auth.createOrg')}</h2>
        {mode === 'register' && (
          <>
            <Field label={t('auth.orgName')}>
              <input className="input" required minLength={2} value={form.orgName} onChange={set('orgName')} autoComplete="organization" />
            </Field>
            <Field label={t('auth.yourName')}>
              <input className="input" required minLength={2} value={form.name} onChange={set('name')} autoComplete="name" />
            </Field>
          </>
        )}
        <Field label={t('auth.email')}>
          <input className="input" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </Field>
        <Field label={t('auth.password')} hint={mode === 'register' ? t('auth.passwordHint') : undefined}>
          <input className="input" type="password" required minLength={mode === 'register' ? 8 : 1} value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
        {err && <div className="callout bad">{err}</div>}
        <button className="btn primary lg" disabled={busy}>
          {mode === 'login' ? t('auth.signIn') : t('auth.createOrg')}
        </button>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
        </button>
      </form>
    </div>
  );
}
