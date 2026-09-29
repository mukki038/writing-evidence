'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dict } from '@/lib/i18n'

export function NewDocForm({ t }: { t: Dict }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(false)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error()
      const d = (await res.json()) as { id: string }
      router.push(`/documents/${d.id}`)
    } catch {
      setErr(true)
      setBusy(false)
    }
  }
  return (
    <form className="new-doc" onSubmit={create}>
      <input
        value={title}
        maxLength={200}
        placeholder={t.dash.titlePlaceholder}
        onChange={(e) => setTitle(e.target.value)}
        aria-label={t.dash.titlePlaceholder}
      />
      <button className="btn btn--primary" disabled={busy}>
        {t.dash.newDoc}
      </button>
      {err && <span className="error small">{t.auth.genericError}</span>}
    </form>
  )
}

export function DeleteDocButton({ id, t }: { id: string; t: Dict }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const del = async () => {
    if (!window.confirm(t.dash.confirmDelete)) return
    setBusy(true)
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' }).catch(() => null)
    setBusy(false)
    if (res?.ok) router.refresh()
  }
  return (
    <button className="btn btn--small btn--ghost btn--danger" onClick={del} disabled={busy}>
      {t.dash.delete}
    </button>
  )
}
