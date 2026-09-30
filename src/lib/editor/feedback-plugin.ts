/**
 * Feedback belgilari — ProseMirror plugin.
 *  - flag'lar hujjat pozitsiyalarida saqlanadi va har tahrirda map qilinadi;
 *  - belgilangan parcha o'zgarsa flag "hal qilingan" bo'ladi: AI varianti
 *    (SOURCE_META = 'ai') yoki talabaning o'zi tuzatgan;
 *  - hujjatning o'zi o'zgarmaydi (faqat decoration) — evidence'ga ta'sir yo'q.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { SOURCE_META } from '../evidence/constants'
import type { Category } from '../feedback/types'
import { findExcerpt } from '../feedback/validate'

export interface FlagState {
  id: string
  from: number
  to: number
  excerpt: string
  category: Category
  reason: string
}

export interface ResolvedFlag {
  id: string
  category: Category
  by: 'ai' | 'self'
}

export interface FeedbackState {
  flags: FlagState[]
  selected: string | null
  resolved: ResolvedFlag[]
}

type Action =
  | { type: 'set'; flags: FlagState[] }
  | { type: 'select'; id: string | null }
  | { type: 'dismiss'; id: string }
  | { type: 'clear' }

export const feedbackKey = new PluginKey<FeedbackState>('feedback')

const EMPTY: FeedbackState = { flags: [], selected: null, resolved: [] }

// ---------------------------------------------------------------------------
// Matn ↔ pozitsiya: textblock'lar "\n" bilan (doc.textBetween(0, size, '\n') bilan bir xil)
// ---------------------------------------------------------------------------
export interface TextIndex {
  text: string
  blocks: Array<{ textStart: number; pos: number; length: number }>
}

export function buildTextIndex(doc: PMNode): TextIndex {
  const blocks: TextIndex['blocks'] = []
  const parts: string[] = []
  let offset = 0
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (blocks.length) offset += 1 // "\n"
    const t = node.textContent
    blocks.push({ textStart: offset, pos: pos + 1, length: t.length })
    parts.push(t)
    offset += t.length
    return false
  })
  return { text: parts.join('\n'), blocks }
}

/** [start, end) matn oralig'i → hujjat pozitsiyalari (bitta textblock ichida bo'lsa) */
export function rangeToPos(index: TextIndex, start: number, end: number): [number, number] | null {
  const b = index.blocks.find((x) => start >= x.textStart && end <= x.textStart + x.length)
  if (!b) return null
  return [b.pos + (start - b.textStart), b.pos + (end - b.textStart)]
}

/** Server flag'larini JORIY hujjatga joylash (so'rov davomida matn o'zgargan bo'lishi mumkin) */
export function placeFlags(
  doc: PMNode,
  flags: Array<{ excerpt: string; category: Category; reason: string; start: number }>,
  idPrefix = 'f',
): FlagState[] {
  const index = buildTextIndex(doc)
  const out: FlagState[] = []
  flags.forEach((f, i) => {
    // server ko'rsatgan joyga eng yaqin mos kelishni qidiramiz
    let hit: [number, number] | null = null
    if (index.text.slice(f.start, f.start + f.excerpt.length) === f.excerpt) hit = [f.start, f.start + f.excerpt.length]
    else hit = findExcerpt(index.text, f.excerpt)
    if (!hit) return
    const pos = rangeToPos(index, hit[0], hit[1])
    if (!pos) return
    if (out.some((o) => pos[0] < o.to && pos[1] > o.from)) return
    out.push({ id: `${idPrefix}${i}`, from: pos[0], to: pos[1], excerpt: index.text.slice(hit[0], hit[1]), category: f.category, reason: f.reason })
  })
  return out.sort((a, b) => a.from - b.from)
}

function applyTr(state: FeedbackState, tr: Transaction): FeedbackState {
  const action = tr.getMeta(feedbackKey) as Action | undefined
  let next = state
  if (action) {
    switch (action.type) {
      case 'set':
        next = { flags: action.flags, selected: null, resolved: [] }
        break
      case 'select':
        next = { ...state, selected: action.id }
        break
      case 'dismiss':
        next = {
          ...state,
          flags: state.flags.filter((f) => f.id !== action.id),
          selected: state.selected === action.id ? null : state.selected,
        }
        break
      case 'clear':
        next = EMPTY
        break
    }
  }
  if (!tr.docChanged || !next.flags.length) return next

  const by: 'ai' | 'self' = tr.getMeta(SOURCE_META) === 'ai' ? 'ai' : 'self'
  const kept: FlagState[] = []
  const resolved = [...next.resolved]
  for (const f of next.flags) {
    const from = tr.mapping.map(f.from, 1)
    const to = tr.mapping.map(f.to, -1)
    if (to > from && tr.doc.textBetween(from, to, '\n') === f.excerpt) {
      kept.push(from === f.from && to === f.to ? f : { ...f, from, to })
    } else {
      resolved.push({ id: f.id, category: f.category, by })
    }
  }
  if (kept.length === next.flags.length && kept.every((f, i) => f === next.flags[i])) return next
  const selected = next.selected && kept.some((f) => f.id === next.selected) ? next.selected : null
  return { flags: kept, selected, resolved }
}

export function feedbackPlugin(): Plugin<FeedbackState> {
  return new Plugin<FeedbackState>({
    key: feedbackKey,
    state: {
      init: () => EMPTY,
      apply: (tr, value) => applyTr(value, tr),
    },
    props: {
      decorations(state: EditorState) {
        const s = feedbackKey.getState(state)
        if (!s?.flags.length) return null
        return DecorationSet.create(
          state.doc,
          s.flags.map((f) =>
            Decoration.inline(f.from, f.to, {
              class: `fb fb--${f.category}${s.selected === f.id ? ' is-selected' : ''}`,
              'data-flag': f.id,
            }),
          ),
        )
      },
      handleClick(view, pos) {
        const s = feedbackKey.getState(view.state)
        const hit = s?.flags.find((f) => pos >= f.from && pos <= f.to)
        if (hit && s?.selected !== hit.id) view.dispatch(view.state.tr.setMeta(feedbackKey, { type: 'select', id: hit.id }))
        return false
      },
    },
  })
}

export const FeedbackHighlights = Extension.create({
  name: 'feedbackHighlights',
  addProseMirrorPlugins() {
    return [feedbackPlugin()]
  },
})

export function getFeedbackState(state: EditorState): FeedbackState {
  return feedbackKey.getState(state) ?? EMPTY
}
