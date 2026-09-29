'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Dict } from '@/lib/i18n'

type Mode = 'login' | 'signup' | 'forgot' | 'update'

function safeNext(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/dashboard'
}

export function AuthForm({ mode, t, configured }: { mode: Mode; t: Dict; configured: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(params.get('error') === 'link' ? t.auth.linkInvalid : null)
  const [done, setDone] = useState<string | null>(null)
  const a = t.auth

  if (!configured) {
    return (
      <div className="auth card">
        <p>{a.notConfigured}</p>
        <Link className="btn btn--primary" href="/demo">
          {t.nav.demo}
        </Link>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const origin = window.location.origin
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.replace(safeNext(params.get('next')))
        router.refresh()
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${origin}/auth/confirm?next=/dashboard` },
        })
        if (error) throw error
        setDone(a.checkEmail)
      } else if (mode === 'forgot') {
        await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm?next=/update-password` })
        setDone(a.resetSent) // email mavjudligi oshkor qilinmaydi
      } else {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setDone(a.passwordUpdated)
        setTimeout(() => router.replace('/dashboard'), 800)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg && msg.length < 160 ? msg : a.genericError)
    } finally {
      setBusy(false)
    }
  }

  const title = { login: a.login, signup: a.signup, forgot: a.forgot, update: a.updatePassword }[mode]

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{title}</h1>
      {done ? (
        <p className="banner banner--info" role="status">
          {done}
        </p>
      ) : (
        <>
          {mode !== 'update' && (
            <label>
              <span>{a.email}</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>
              <span>{mode === 'update' ? a.passwordNew : a.password}</span>
              <input
                type="password"
                required
                minLength={mode === 'login' ? 1 : 8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== 'login' && <small className="muted">{a.minPassword}</small>}
            </label>
          )}
          {mode === 'signup' && (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
              <span>
                {a.consent} <Link href="/privacy">{t.nav.privacy}</Link>
              </span>
            </label>
          )}
          {error && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary" disabled={busy || (mode === 'signup' && !consent)}>
            {mode === 'forgot' ? a.sendReset : title}
          </button>
        </>
      )}
      <div className="auth-links small">
        {mode === 'login' && (
          <>
            <Link href="/forgot">{a.forgot}</Link>
            <span>
              {a.noAccount} <Link href="/signup">{a.signup}</Link>
            </span>
          </>
        )}
        {mode === 'signup' && (
          <span>
            {a.haveAccount} <Link href="/login">{a.login}</Link>
          </span>
        )}
        {mode === 'forgot' && <Link href="/login">{a.login}</Link>}
      </div>
    </form>
  )
}
