'use client'
/**
 * To'liq editor sahifasi: yuklash → autosave/offline/409 → recovered draft.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Editor } from '@tiptap/react'
import { EditorCore, type EditorHandle } from './EditorCore'
import { EvidenceSync, drainOutbox, type SyncStatus } from '@/lib/sync/controller'
import { deviceStore, type Packet, type RecoveredDraft } from '@/lib/sync/store'
import { contentText, wordCount, type PMJSON } from '@/lib/evidence/text'
import { HARD_WORD_LIMIT, SOFT_WORD_LIMIT, SOURCE_META } from '@/lib/evidence/constants'
import type { RawMutation } from '@/lib/evidence/recorder'
import type { Dict } from '@/lib/i18n'
import { Time } from './Time'

interface LoadedDoc {
  title: string
  content_json: PMJSON
  version: number
}

type Phase = 'loading' | 'ready' | 'error'

export function DocumentEditor({ id, t, locale }: { id: string; t: Dict; locale: string }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [status, setStatus] = useState<{ s: SyncStatus; detail?: string }>({ s: 'saved' })
  const [online, setOnline] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<RecoveredDraft | null>(null)
  const [showDraft, setShowDraft] = useState(false)
  const [words, setWords] = useState(0)
  const [title, setTitle] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const syncRef = useRef<EvidenceSync | null>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const wordTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const tRef = useRef(t)
  tRef.current = t

  // ---------------------------------------------------------------- yuklash
  useEffect(() => {
    let cancelled = false
    let release = () => {}
    const store = deviceStore()

    ;(async () => {
      setPhase('loading')
      const lock = await acquireTabLock(id)
      release = lock.release
      if (cancelled) return release()
      setReadOnly(!lock.held)

      // Oldingi tashrifdan qolgan saqlanmagan paketlar — avval ular
      let initialOutbox: Packet[] = []
      let localContent: LoadedDoc | null = null
      if (lock.held) {
        const drained = await drainOutbox(id, store)
        if (drained.result === 'conflict') setNotice(tRef.current.editor.conflict)
        if (drained.result === 'offline' && drained.outbox.length) {
          initialOutbox = drained.outbox
          const last = drained.outbox[drained.outbox.length - 1]
          localContent = { title: '', content_json: last.content_json, version: last.base_version + 1 }
        }
      }

      let loaded: LoadedDoc | null = null
      try {
        const res = await fetch(`/api/documents/${id}`, { cache: 'no-store' })
        if (res.status === 401) {
          window.location.href = `/login?next=/documents/${id}`
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        const server = (await res.json()) as LoadedDoc
        loaded = localContent ? { ...localContent, title: server.title } : server
      } catch {
        loaded = localContent
      }
      if (cancelled) return
      if (!loaded) {
        setPhase('error')
        return
      }

      setDraft((await store.getDraft(id).catch(() => undefined)) ?? null)

      const sync = new EvidenceSync({
        documentId: id,
        baseVersion: loaded.version,
        initialOutbox,
        store,
        getContent: () => (handleRef.current?.editor.getJSON() as PMJSON) ?? loaded!.content_json,
        onStatus: (s, detail) => setStatus({ s, detail }),
        onConflict: (server) => {
          setDoc({ title: server.title, content_json: server.content_json, version: server.version })
          setEditorKey((k) => k + 1)
          setNotice(tRef.current.editor.conflict)
          store.getDraft(id).then((d) => setDraft(d ?? null))
        },
      })
      syncRef.current = sync
      if (lock.held) await sync.start()
      if (cancelled) {
        sync.stop()
        return
      }
      setDoc(loaded)
      setTitle(loaded.title)
      setPhase('ready')
    })()

    return () => {
      cancelled = true
      const s = syncRef.current
      syncRef.current = null
      if (s) void s.saveNow().finally(() => s.stop())
      release()
    }
  }, [id, reloadTick])

  // ---------------------------------------------------------------- sahifa hodisalari
  useEffect(() => {
    if (phase !== 'ready') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void syncRef.current?.saveNow()
    }
    const onBlur = () => void syncRef.current?.saveNow()
    const onPageHide = () => syncRef.current?.pagehide()
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) syncRef.current?.resume()
    }
    const onOnline = () => {
      setOnline(true)
      syncRef.current?.online()
    }
    const onOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [phase])

  const onMutation = useCallback((m: RawMutation) => syncRef.current?.onMutation(m), [])

  const onUpdate = useCallback((editor: Editor) => {
    clearTimeout(wordTimer.current)
    wordTimer.current = setTimeout(() => {
      const d = editor.state.doc
      setWords(wordCount(d.textBetween(0, d.content.size, '\n')))
    }, 250)
  }, [])

  const onTitle = (v: string) => {
    setTitle(v)
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      void fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: v.slice(0, 200) }),
      }).catch(() => undefined)
    }, 800)
  }

  const insertDraft = async () => {
    const h = handleRef.current
    if (!h || !draft) return
    const content = draft.content_json.content ?? []
    h.signals.markUserAction()
    h.editor
      .chain()
      .setMeta(SOURCE_META, 'recovered')
      .insertContentAt(h.editor.state.doc.content.size, content)
      .run()
    await deviceStore().deleteDraft(id)
    setDraft(null)
    setShowDraft(false)
  }

  const deleteDraft = async () => {
    await deviceStore().deleteDraft(id)
    setDraft(null)
    setShowDraft(false)
  }

  if (phase === 'loading') return <p className="muted pad">{t.editor.loading}</p>
  if (phase === 'error' || !doc)
    return (
      <div className="pad">
        <p>{t.editor.loadError}</p>
        <button className="btn" onClick={() => setReloadTick((n) => n + 1)}>
          {t.editor.retry}
        </button>
      </div>
    )

  const statusText = readOnly
    ? t.editor.readOnly
    : !online || status.s === 'offline'
      ? t.editor.offline
      : status.s === 'error'
        ? status.detail === 'auth'
          ? t.editor.authError
          : t.editor.error
        : status.s === 'saving'
          ? t.editor.saving
          : t.editor.saved

  return (
    <div className="doc-page">
      <div className="doc-top">
        <Link href="/dashboard" className="muted small">
          {t.editor.back}
        </Link>
        <input
          className="doc-title"
          value={title}
          placeholder={t.editor.untitled}
          maxLength={200}
          onChange={(e) => onTitle(e.target.value)}
          disabled={readOnly}
          aria-label={t.dash.titlePlaceholder}
        />
        <div className="doc-meta">
          <span>
            {words.toLocaleString()} {t.editor.words}
          </span>
          <Link href={`/documents/${id}/timeline`} className="small">
            {t.editor.timeline}
          </Link>
        </div>
      </div>

      {readOnly && (
        <div className="banner banner--info">
          {t.editor.readOnly}{' '}
          <button className="btn btn--small" onClick={() => window.location.reload()}>
            {t.editor.takeOver}
          </button>
        </div>
      )}
      {notice && (
        <div className="banner banner--warn" role="status">
          {notice}
          <button className="banner-close" aria-label="×" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {words > HARD_WORD_LIMIT ? (
        <div className="banner banner--error">{t.editor.hardLimit}</div>
      ) : words > SOFT_WORD_LIMIT ? (
        <div className="banner banner--info">{t.editor.softLimit}</div>
      ) : null}

      {draft && !readOnly && (
        <div className="banner banner--draft">
          <div className="draft-head">
            <strong>{t.editor.draftTitle}</strong>
            <span className="muted small">
              <Time iso={new Date(draft.saved_at).toISOString()} locale={locale} /> {t.editor.draftSaved}
            </span>
            <span className="grow" />
            <button className="btn btn--small" onClick={() => setShowDraft((v) => !v)}>
              {showDraft ? t.editor.draftHide : t.editor.draftShow}
            </button>
            <button className="btn btn--small" onClick={insertDraft}>
              {t.editor.draftInsert}
            </button>
            <button className="btn btn--small btn--ghost" onClick={deleteDraft}>
              {t.editor.draftDelete}
            </button>
          </div>
          {showDraft && <pre className="draft-preview">{contentText(draft.content_json)}</pre>}
        </div>
      )}

      <EditorCore
        key={editorKey}
        initialContent={doc.content_json}
        editable={!readOnly}
        onMutation={onMutation}
        onUpdate={onUpdate}
        onReady={(h) => {
          handleRef.current = h
        }}
        t={t}
      />

      <div className={`statusbar statusbar--${readOnly ? 'readonly' : !online ? 'offline' : status.s}`} role="status" aria-live="polite">
        <span className="rec-dot" aria-hidden />
        <span>{readOnly ? '' : t.editor.recordActive}</span>
        <span className="grow" />
        <span>{statusText}</span>
      </div>
    </div>
  )
}

/**
 * Bitta browser'da bitta aktiv tab (TZ §12). Web Locks API — BroadcastChannel'dan
 * farqli ravishda poyga holatisiz. StrictMode'da qayta mount uchun qisqa retry.
 */
async function acquireTabLock(id: string): Promise<{ held: boolean; release: () => void }> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return { held: true, release: () => {} }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await new Promise<{ held: boolean; release: () => void }>((resolve) => {
      let release!: () => void
      const hold = new Promise<void>((r2) => (release = r2))
      navigator.locks
        .request(`writing-evidence:${id}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve({ held: false, release: () => {} })
            return
          }
          resolve({ held: true, release })
          await hold
        })
        .catch(() => resolve({ held: true, release: () => {} }))
    })
    if (r.held) return r
    await new Promise((res) => setTimeout(res, 150))
  }
  return { held: false, release: () => {} }
}
