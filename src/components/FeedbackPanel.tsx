'use client'
/**
 * AI writing feedback paneli (TZ v4 MVP-B, demo uchun oldinroq).
 * Qoidalar: butun matn qayta yozilmaydi; variant faqat belgilangan parcha
 * uchun; qo'llangan variant SOURCE_META='ai' bilan kiritiladi → origin: ai.
 */
import { useEffect, useRef, useState } from 'react'
import type { EditorHandle } from './EditorCore'
import { SOURCE_META } from '@/lib/evidence/constants'
import {
  buildTextIndex,
  feedbackKey,
  getFeedbackState,
  placeFlags,
  type FeedbackState,
  type FlagState,
} from '@/lib/editor/feedback-plugin'
import { MIN_WORDS, wordCount, type AnalyzeResponse, type VariantsResponse } from '@/lib/feedback/types'
import type { Dict, Locale } from '@/lib/i18n'

const CONSENT_KEY = 'we.llmConsent.v1'

type Phase = 'idle' | 'consent' | 'loading' | 'done'
type VariantState = { status: 'loading' | 'done' | 'error'; items: string[]; error?: string }

function readConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

function writeConsent() {
  try {
    window.localStorage.setItem(CONSENT_KEY, '1')
  } catch {
    /* private rejim — faqat shu sahifa uchun */
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? 'upstream' }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function FeedbackPanel({ handle, t, locale }: { handle: EditorHandle | null; t: Dict; locale: Locale }) {
  const fb = t.fb
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<FeedbackState>({ flags: [], selected: null, resolved: [] })
  const [variants, setVariants] = useState<Record<string, VariantState>>({})
  const consented = useRef(false)
  const run = useRef(0)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    consented.current = readConsent()
  }, [])

  // Plugin holatini kuzatish
  useEffect(() => {
    if (!handle) return
    const editor = handle.editor
    const sync = () => setState(getFeedbackState(editor.state))
    sync()
    editor.on('transaction', sync)
    return () => {
      editor.off('transaction', sync)
    }
  }, [handle])

  // Matndagi belgi bosilganda — ro'yxatdagi kartani ko'rsatish
  useEffect(() => {
    if (!state.selected || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-flag-item="${state.selected}"]`)
    const r = el?.getBoundingClientRect()
    if (el && r && (r.top < 60 || r.bottom > window.innerHeight)) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.selected])

  const dispatchMeta = (meta: unknown) => {
    if (!handle) return
    const { view } = handle.editor
    view.dispatch(view.state.tr.setMeta(feedbackKey, meta))
  }

  const start = () => {
    setError(null)
    if (!handle) return
    const { text } = buildTextIndex(handle.editor.state.doc)
    if (wordCount(text) < MIN_WORDS) {
      setError(fb.errors.too_short)
      return
    }
    if (!consented.current) {
      setPhase('consent')
      return
    }
    void analyze()
  }

  const agree = () => {
    consented.current = true
    writeConsent()
    void analyze()
  }

  const analyze = async () => {
    if (!handle) return
    const editor = handle.editor
    const { text } = buildTextIndex(editor.state.doc)
    const myRun = ++run.current
    setPhase('loading')
    setError(null)
    const r = await postJson<AnalyzeResponse>('/api/feedback', { text, locale })
    if (myRun !== run.current) return
    if (!r.ok) {
      setError(fb.errors[r.error] ?? fb.errors.upstream)
      setPhase(state.flags.length || total ? 'done' : 'idle')
      return
    }
    const flags = placeFlags(editor.state.doc, r.data.flags, `r${myRun}-`)
    editor.view.dispatch(editor.state.tr.setMeta(feedbackKey, { type: 'set', flags }))
    setVariants({})
    setSummary(r.data.summary)
    setTotal(flags.length)
    setPhase('done')
  }

  const select = (f: FlagState) => {
    if (!handle) return
    dispatchMeta({ type: 'select', id: state.selected === f.id ? null : f.id })
    try {
      const { node } = handle.editor.view.domAtPos(f.from)
      const el = node instanceof HTMLElement ? node : node.parentElement
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* ko'rinmasa ham mayli */
    }
  }

  const loadVariants = async (f: FlagState) => {
    if (!handle) return
    const index = buildTextIndex(handle.editor.state.doc)
    const b = index.blocks.find((x) => f.from >= x.pos && f.to <= x.pos + x.length)
    if (!b) return
    const s = b.textStart + (f.from - b.pos)
    const e = s + f.excerpt.length
    setVariants((v) => ({ ...v, [f.id]: { status: 'loading', items: [] } }))
    const r = await postJson<VariantsResponse>('/api/feedback/variants', {
      excerpt: f.excerpt,
      category: f.category,
      reason: f.reason.slice(0, 500),
      before: index.text.slice(Math.max(0, s - 600), s),
      after: index.text.slice(e, e + 400),
      locale,
    })
    setVariants((v) => ({
      ...v,
      [f.id]: r.ok
        ? { status: 'done', items: r.data.variants }
        : { status: 'error', items: [], error: fb.errors[r.error] ?? fb.errors.upstream },
    }))
  }

  const apply = (f: FlagState, text: string) => {
    if (!handle) return
    const cur = getFeedbackState(handle.editor.state).flags.find((x) => x.id === f.id)
    if (!cur) return
    // TipTap focus() bir kadr kechikadi — sinxron fokus (telefonda klaviatura ham shunda ochiladi)
    handle.editor.view.focus()
    handle.editor
      .chain()
      .command(({ tr }) => {
        tr.insertText(text, cur.from, cur.to)
        tr.setMeta(SOURCE_META, 'ai')
        return true
      })
      .run()
  }

  const selfFix = (f: FlagState) => {
    if (!handle) return
    handle.editor.view.focus()
    handle.editor.chain().setTextSelection({ from: f.from, to: f.to }).scrollIntoView().run()
  }

  const aiFixed = state.resolved.filter((r) => r.by === 'ai').length
  const selfFixed = state.resolved.filter((r) => r.by === 'self').length

  return (
    <section className="fb-panel card" aria-live="polite">
      <div className="fb-head">
        <h2>✦ {fb.title}</h2>
        {phase !== 'consent' && (
          <button className="btn btn--primary btn--small" onClick={start} disabled={phase === 'loading' || !handle}>
            {phase === 'loading' ? fb.checking : phase === 'done' ? fb.recheck : fb.check}
          </button>
        )}
      </div>
      {phase === 'idle' && <p className="muted small">{fb.intro}</p>}

      {phase === 'consent' && (
        <div className="fb-consent">
          <p className="small">{fb.consentText}</p>
          <div className="fb-row">
            <button className="btn btn--primary btn--small" onClick={agree}>
              {fb.consentAgree}
            </button>
            <button className="btn btn--small btn--ghost" onClick={() => setPhase('idle')}>
              {fb.cancel}
            </button>
          </div>
        </div>
      )}

      {phase === 'loading' && <div className="fb-loading" aria-hidden />}
      {error && (
        <p className="banner banner--error small" role="alert">
          {error}
        </p>
      )}

      {phase === 'done' && (
        <>
          {summary && <p className="fb-summary">{summary}</p>}
          <p className="muted small">{total ? fb.found.replace('{n}', String(total)) : fb.none}</p>
          {(aiFixed > 0 || selfFixed > 0) && (
            <p className="fb-resolved small">
              {selfFixed > 0 && (
                <span className="chip chip--typing">
                  ✓ {fb.resolvedSelf}: {selfFixed}
                </span>
              )}
              {aiFixed > 0 && (
                <span className="chip chip--ai">
                  ✓ {fb.resolvedAi}: {aiFixed}
                </span>
              )}
            </p>
          )}
          <ol className="fb-list" ref={listRef}>
            {state.flags.map((f) => {
              const open = state.selected === f.id
              const v = variants[f.id]
              return (
                <li key={f.id} data-flag-item={f.id} className={`fb-item ${open ? 'is-open' : ''}`}>
                  <button className="fb-item-head" onClick={() => select(f)} aria-expanded={open}>
                    <span className={`fb-cat fb-cat--${f.category}`}>{fb.categories[f.category]}</span>
                    <span className="fb-excerpt">“{f.excerpt.length > 90 ? f.excerpt.slice(0, 87) + '…' : f.excerpt}”</span>
                  </button>
                  {open && (
                    <div className="fb-body">
                      <p className="fb-reason">{f.reason}</p>
                      {!v && (
                        <div className="fb-row">
                          <button className="btn btn--small btn--primary" onClick={() => loadVariants(f)}>
                            {fb.variants}
                          </button>
                          <button className="btn btn--small" onClick={() => selfFix(f)}>
                            {fb.selfFix}
                          </button>
                          <button className="btn btn--small btn--ghost" onClick={() => dispatchMeta({ type: 'dismiss', id: f.id })}>
                            {fb.dismiss}
                          </button>
                        </div>
                      )}
                      {v?.status === 'loading' && <p className="muted small">{fb.variantsLoading}</p>}
                      {v?.status === 'error' && <p className="error small">{v.error}</p>}
                      {v?.status === 'done' && (
                        <>
                          <ol className="fb-variants">
                            {v.items.map((text, i) => (
                              <li key={i}>
                                <span>{text}</span>
                                <button className="btn btn--small" onClick={() => apply(f, text)}>
                                  {fb.apply}
                                </button>
                              </li>
                            ))}
                          </ol>
                          <div className="fb-row">
                            <button className="btn btn--small" onClick={() => selfFix(f)}>
                              {fb.selfFix}
                            </button>
                            <button className="btn btn--small btn--ghost" onClick={() => dispatchMeta({ type: 'dismiss', id: f.id })}>
                              {fb.dismiss}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
      <p className="muted small fb-note">{fb.note}</p>
    </section>
  )
}
