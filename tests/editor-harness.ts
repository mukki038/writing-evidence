/**
 * Headless editor: EditorState + recorder + history, testlar uchun.
 * Real brauzer signallari o'rniga signal holati qo'lda boshqariladi.
 */
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Slice, Fragment } from '@tiptap/pm/model'
import { history, undo, redo } from '@tiptap/pm/history'
import { wrapInList } from '@tiptap/pm/schema-list'
import { splitBlock } from '@tiptap/pm/commands'
import { editorSchema, EMPTY_DOC } from '../src/lib/editor/extensions'
import { createRecorder, type RawMutation } from '../src/lib/evidence/recorder'
import { SOURCE_META } from '../src/lib/evidence/constants'
import type { SignalState } from '../src/lib/evidence/signals'
import type { PMJSON } from '../src/lib/evidence/text'

export function makeEditor(initial: PMJSON = EMPTY_DOC, startClock = 1_700_000_000_000, randomIds = false) {
  let clock = startClock
  let n = 0
  const signals: SignalState = {
    lastUserInputAt: Number.NEGATIVE_INFINITY,
    lastReplacementAt: Number.NEGATIVE_INFINITY,
    lastPasteAt: Number.NEGATIVE_INFINITY,
    lastDropAt: Number.NEGATIVE_INFINITY,
    composing: false,
  }
  const hex = () => (n++).toString(16).padStart(12, '0')
  const recorder = createRecorder({
    signals,
    now: () => clock,
    uuid: randomIds ? () => crypto.randomUUID() : () => `00000000-0000-4000-8000-${hex()}`,
  })
  let state = EditorState.create({
    schema: editorSchema,
    doc: editorSchema.nodeFromJSON(initial),
    plugins: [history(), recorder.plugin],
  })
  const mutations: RawMutation[] = []

  const api = {
    signals,
    recorder,
    mutations,
    get state() {
      return state
    },
    get doc() {
      return state.doc
    },
    tick(ms = 50) {
      clock += ms
    },
    get clock() {
      return clock
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
      mutations.push(...recorder.drain())
    },
    /** klaviatura signali bilan yozish */
    userSignal() {
      signals.lastUserInputAt = clock
    },
    type(text: string) {
      for (const ch of text) {
        api.tick(80)
        api.userSignal()
        api.dispatch(state.tr.insertText(ch))
      }
    },
    typeChunk(text: string) {
      api.tick(80)
      api.userSignal()
      api.dispatch(state.tr.insertText(text))
    },
    select(from: number, to = from) {
      api.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
    },
    deleteSelection() {
      api.tick(80)
      api.userSignal()
      api.dispatch(state.tr.deleteSelection())
    },
    enter() {
      api.tick(80)
      api.userSignal()
      splitBlock(state, (tr) => api.dispatch(tr))
    },
    wrapBulletList() {
      api.tick(80)
      api.userSignal()
      wrapInList(editorSchema.nodes.bulletList)(state, (tr) => api.dispatch(tr))
    },
    toggleBold(from: number, to: number) {
      api.tick(80)
      api.userSignal()
      api.dispatch(state.tr.addMark(from, to, editorSchema.marks.bold.create()))
    },
    insertAi(text: string) {
      api.tick(200)
      api.dispatch(state.tr.insertText(text).setMeta(SOURCE_META, 'ai'))
    },
    /** tashqi paste: slice ixtiyoriy mark'lar bilan (clipboard HTML'ni simulyatsiya) */
    paste(slice: Slice) {
      api.tick(120)
      signals.lastUserInputAt = clock
      signals.lastPasteAt = clock
      api.dispatch(state.tr.replaceSelection(slice).setMeta('paste', true).setMeta('uiEvent', 'paste'))
    },
    pasteText(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []) {
      const node = editorSchema.text(text, marks.map((m) => editorSchema.mark(m.type, m.attrs)))
      api.paste(new Slice(Fragment.from(node), 0, 0))
    },
    cut() {
      recorder.recordCopy(state)
      api.tick(80)
      api.dispatch(state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
    },
    copy() {
      recorder.recordCopy(state)
    },
    undo() {
      api.tick(80)
      api.userSignal()
      return undo(state, (tr) => api.dispatch(tr))
    },
    redo() {
      api.tick(80)
      api.userSignal()
      return redo(state, (tr) => api.dispatch(tr))
    },
    /** foydalanuvchi signalisiz o'zgarish (extension'lar) */
    silentInsert(text: string) {
      api.tick(5000)
      api.dispatch(state.tr.insertText(text))
    },
    endPos() {
      return state.doc.content.size - 1
    },
  }
  return api
}
