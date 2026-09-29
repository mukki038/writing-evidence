'use client'
/**
 * Editor yadrosi: TipTap + evidence recorder + kiritish signallari.
 * Har bir instance o'z recorder'iga ega (409 dan keyin qayta yaratiladi).
 */
import { useEffect, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { Placeholder, UndoRedo, Dropcursor } from '@tiptap/extensions'
import { EvidenceRecorder, schemaExtensions } from '@/lib/editor/extensions'
import { createRecorder, type RawMutation, type Recorder } from '@/lib/evidence/recorder'
import { InputSignals } from '@/lib/evidence/signals'
import type { PMJSON } from '@/lib/evidence/text'
import type { Dict } from '@/lib/i18n'

export interface EditorHandle {
  editor: Editor
  recorder: Recorder
  signals: InputSignals
}

interface Props {
  initialContent: PMJSON
  editable: boolean
  onMutation: (m: RawMutation) => void
  onUpdate?: (editor: Editor) => void
  onReady?: (h: EditorHandle) => void
  t: Dict
}

export function EditorCore({ initialContent, editable, onMutation, onUpdate, onReady, t }: Props) {
  // recorder va signallar shu editor instance'i bilan birga yashaydi
  const onMutationRef = useLatest(onMutation)
  const [signals] = useState(() => new InputSignals())
  const [recorder] = useState(() => createRecorder({ signals, onMutation: (m) => onMutationRef.current(m) }))

  const editor = useEditor({
    extensions: [
      ...schemaExtensions,
      UndoRedo,
      Dropcursor,
      Placeholder.configure({ placeholder: t.editor.placeholder }),
      EvidenceRecorder.configure({ recorder }),
    ],
    content: initialContent,
    editable,
    immediatelyRender: false,
    enablePasteRules: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'doc-editor', spellcheck: 'true', lang: 'en', 'aria-label': 'Document' },
    },
    onUpdate: ({ editor }) => onUpdate?.(editor),
  })

  useEffect(() => {
    if (!editor) return
    const detach = signals.attach(editor.view.dom)
    const offComp = signals.onCompositionEnd(() => setTimeout(() => recorder.applyDeferred(editor.view), 0))
    onReady?.({ editor, recorder, signals })
    onUpdate?.(editor)
    return () => {
      detach()
      offComp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (!editor) return <div className="doc-editor doc-editor--loading">{t.editor.loading}</div>

  return (
    <div className="editor-shell">
      {editable && <Toolbar editor={editor} signals={signals} t={t} />}
      <EditorContent editor={editor} />
    </div>
  )
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }))
  ref.current = value
  return ref
}

function Toolbar({ editor, signals, t }: { editor: Editor; signals: InputSignals; t: Dict }) {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    editor.on('selectionUpdate', fn)
    editor.on('transaction', fn)
    return () => {
      editor.off('selectionUpdate', fn)
      editor.off('transaction', fn)
    }
  }, [editor])

  const tb = t.editor.toolbar
  // Toolbar — foydalanuvchi harakati (manba: typing, 0 belgi)
  const run = (fn: () => void) => {
    signals.markUserAction()
    fn()
  }
  const btn = (label: string, text: string, active: boolean, fn: () => void, cls = '') => (
    <button
      type="button"
      className={`tb-btn ${active ? 'is-active' : ''} ${cls}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(fn)}
    >
      {text}
    </button>
  )
  const c = () => editor.chain().focus()
  return (
    <div className="toolbar" role="toolbar">
      {btn(tb.bold, 'B', editor.isActive('bold'), () => c().toggleBold().run(), 'tb-bold')}
      {btn(tb.italic, 'I', editor.isActive('italic'), () => c().toggleItalic().run(), 'tb-italic')}
      <span className="tb-sep" />
      {btn(tb.h1, 'H1', editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run())}
      {btn(tb.h2, 'H2', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
      {btn(tb.h3, 'H3', editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run())}
      <span className="tb-sep" />
      {btn(tb.bullet, '•', editor.isActive('bulletList'), () => c().toggleBulletList().run())}
      {btn(tb.ordered, '1.', editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
      {btn(tb.quote, '❝', editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
      <span className="tb-sep" />
      {btn(tb.undo, '↶', false, () => c().undo().run())}
      {btn(tb.redo, '↷', false, () => c().redo().run())}
    </div>
  )
}
