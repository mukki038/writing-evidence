'use client'
import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import type { Editor } from '@tiptap/react'
import { EditorCore, type EditorHandle } from './EditorCore'
import { TimelineView } from './TimelineView'
import { DemoModel } from '@/lib/evidence/demo-model'
import { composition, type Composition } from '@/lib/evidence/composition'
import { SOURCE_META } from '@/lib/evidence/constants'
import type { RawMutation } from '@/lib/evidence/recorder'
import { wordCount } from '@/lib/evidence/text'
import type { TimelineData } from '@/lib/evidence/timeline'
import { EMPTY_DOC } from '@/lib/editor/extensions'
import type { Dict, Locale } from '@/lib/i18n'

export function DemoClient({ t, locale, canSignUp }: { t: Dict; locale: Locale; canSignUp: boolean }) {
  const [key, setKey] = useState(0)
  const model = useRef(new DemoModel())
  const handle = useRef<EditorHandle | null>(null)
  const [data, setData] = useState<TimelineData>(() => model.current.data('Demo'))
  const [comp, setComp] = useState<Composition | null>(null)
  const [recent, setRecent] = useState(model.current.recent)
  const [pageLang, setPageLang] = useState<'en' | 'ko'>('en')
  const [showOrigins, setShowOrigins] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = useCallback((editor: Editor | null) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (editor) {
        const d = editor.state.doc
        model.current.sample(wordCount(d.textBetween(0, d.content.size, '\n')))
        setComp(composition(d))
      }
      setData(model.current.data('Demo'))
      setRecent([...model.current.recent])
    }, 150)
  }, [])

  const onMutation = useCallback(
    (m: RawMutation) => {
      model.current.add(m)
      refresh(handle.current?.editor ?? null)
    },
    [refresh],
  )

  const insertAi = () => {
    const h = handle.current
    if (!h) return
    h.editor.chain().focus().setMeta(SOURCE_META, 'ai').insertContent(t.demo.aiSample + ' ').run()
  }

  const reset = () => {
    model.current = new DemoModel()
    setData(model.current.data('Demo'))
    setComp(null)
    setRecent([])
    setKey((k) => k + 1)
  }

  return (
    <div className="demo">
      <header className="demo-head">
        <h1>{t.demo.title}</h1>
        <p className="muted">{t.demo.intro}</p>
      </header>

      <div className="demo-grid">
        <section className={`demo-editor card ${showOrigins ? 'show-origins' : ''}`}>
          <EditorCore
            key={key}
            initialContent={EMPTY_DOC}
            editable
            onMutation={onMutation}
            onUpdate={(e) => refresh(e)}
            onReady={(h) => {
              handle.current = h
            }}
            t={t}
          />
          <div className="demo-actions">
            <button className="btn btn--small" onClick={insertAi}>
              {t.demo.aiButton}
            </button>
            <button className="btn btn--small btn--ghost" onClick={reset}>
              {t.demo.reset}
            </button>
            <label className="toggle small">
              <input type="checkbox" checked={showOrigins} onChange={(e) => setShowOrigins(e.target.checked)} />
              {t.demo.showOrigins}
            </label>
          </div>
          <div className="statusbar statusbar--saved">
            <span className="rec-dot" aria-hidden />
            <span>{t.editor.recordActive}</span>
          </div>
        </section>

        <aside className="demo-live card">
          <h2>{t.demo.live}</h2>
          <h3 className="small-h">{t.demo.recentActivity}</h3>
          {recent.length === 0 ? (
            <p className="muted small">{t.demo.noActivity}</p>
          ) : (
            <ul className="recent">
              {recent.map((r, i) => (
                <li key={`${r.t}-${i}`}>
                  <span className={`chip chip--${r.source}`}>{t.origin[r.source] ?? labelFor(r.source, locale)}</span>
                  <span className="muted small">
                    {r.inserted_chars > 0 && `+${r.inserted_chars}`} {r.deleted_chars > 0 && `−${r.deleted_chars}`} {t.tl.chars}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <TimelineView data={data} composition={comp} t={t} locale={locale} compact />
        </aside>
      </div>

      <section className="evidence-preview card">
        <div className="ep-head">
          <h2>{t.demo.evidencePreview}</h2>
          <div className="seg" role="tablist">
            {(['en', 'ko'] as const).map((l) => (
              <button key={l} role="tab" aria-selected={pageLang === l} className={pageLang === l ? 'is-active' : ''} onClick={() => setPageLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <ol className="statements" lang={pageLang}>
          {t.statements[pageLang].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="muted small">{t.demo.evidenceNote}</p>
        {canSignUp && (
          <Link className="btn btn--primary" href="/signup">
            {t.demo.signup}
          </Link>
        )}
      </section>
    </div>
  )
}

function labelFor(source: string, locale: Locale): string {
  const map: Record<string, [string, string]> = {
    typing: ['Yozish', 'Typing'],
    delete: ['O‘chirish', 'Delete'],
    history: ['Undo/redo', 'Undo/redo'],
  }
  return map[source]?.[locale === 'uz' ? 0 : 1] ?? source
}
