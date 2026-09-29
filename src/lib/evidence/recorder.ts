/**
 * Writing Evidence recorder — ProseMirror plugin (TZ v4 §10.5–§10.7, §10.9).
 *
 * Vazifalari:
 *  1. Har bir hujjat o'zgartiruvchi tranzaksiyadan mutation yozuvi hosil qilish.
 *     Hajmlar step map'lardan olinadi, shuning uchun
 *     Σ(inserted_size − deleted_size) har doim doc.content.size farqiga ANIQ teng
 *     (formatlash, ro'yxatga o'rash kabi tuzilma o'zgarishlarida ham).
 *  2. Manbani aniqlash (typing, paste, drop, …) — tranzaksiya meta'lari +
 *     klaviatura/IME signallari.
 *  3. Origin mark qoidalari (TZ §10.7 jadvali).
 *
 * Plugin TipTap editoriga bog'liq emas — testlarda to'g'ridan-to'g'ri
 * EditorState bilan ishlatiladi.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import {
  BULK_THRESHOLD,
  CLIPBOARD_SIGNAL_WINDOW_MS,
  COPY_HISTORY_SIZE,
  COPY_TTL_MS,
  FIX_META,
  HISTORY_META,
  SKIP_META,
  SOURCE_META,
  USER_SIGNAL_WINDOW_MS,
  isOriginSource,
  type OriginSource,
  type Source,
} from './constants'
import type { SignalState } from './signals'
import { clipboardHash } from './text'

/** Recorder chiqaradigan xom mutation (session_id/seq sync qatlamida qo'shiladi) */
export interface RawMutation {
  client_mutation_id: string
  from: number
  to: number
  deleted_size: number
  inserted_size: number
  deleted_chars: number
  inserted_chars: number
  source: Source
  /** client vaqti, epoch ms */
  t: number
}

type Run = [length: number, source: OriginSource | null]

interface CopyRecord {
  hash: string
  chars: number
  runs: Run[]
  at: number
}

interface Classification {
  source: Source
  mutation: RawMutation | null
  /** tr.doc koordinatalarida kiritilgan oraliqlar */
  ranges: Array<[number, number]>
  /** ichki ko'chirish (clipboard orqali): asl origin'lar, belgi bo'yicha */
  runs?: Run[]
  /** ichki drag&drop: slice to'g'ridan-to'g'ri hujjatdan — mark'lar o'zgarmaydi */
  keepMarks?: boolean
}

export interface RecorderOptions {
  signals: SignalState
  onMutation?: (m: RawMutation) => void
  now?: () => number
  uuid?: () => string
}

export interface Recorder {
  plugin: Plugin
  /** Hali chiqarilmagan mutation'larni olish (view'siz testlar uchun) */
  drain(): RawMutation[]
  /** IME tugagandan keyin kechiktirilgan origin tuzatishini qo'llash */
  applyDeferred(view: EditorView): void
  /** Test uchun: nusxa olish amalini qayd qilish */
  recordCopy(state: EditorState): void
}

export const recorderKey = new PluginKey('evidenceRecorder')

export function createRecorder(opts: RecorderOptions): Recorder {
  const now = opts.now ?? (() => Date.now())
  const uuid = opts.uuid ?? (() => crypto.randomUUID())
  const signals = opts.signals

  const cache = new WeakMap<Transaction, Classification>()
  const copies: CopyRecord[] = []
  let pending: RawMutation[] = []
  let internalDropPending = false
  /** IME composition paytida typing oraliqlaridan origin olib tashlash kechiktiriladi */
  let deferredTyping: Array<[number, number]> = []

  function recordCopy(state: EditorState): void {
    const { from, to, empty } = state.selection
    if (empty) return
    const text = state.doc.textBetween(from, to, '\n', '')
    const runs: Run[] = []
    let chars = 0
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return
      const len = Math.min(to, pos + node.nodeSize) - Math.max(from, pos)
      if (len <= 0) return
      const src = originOf(node.marks)
      const last = runs[runs.length - 1]
      if (last && last[1] === src) last[0] += len
      else runs.push([len, src])
      chars += len
    })
    const t = now()
    copies.unshift({ hash: clipboardHash(text), chars, runs, at: t })
    while (copies.length > COPY_HISTORY_SIZE) copies.pop()
  }

  function findCopy(hash: string, chars: number, t: number): CopyRecord | undefined {
    return copies.find((c) => t - c.at <= COPY_TTL_MS && c.hash === hash && c.chars === chars)
  }

  function classify(tr: Transaction): Classification {
    const cached = cache.get(tr)
    if (cached) return cached
    const t = now()

    // 1) Hajm va belgilar — har bir step map'idan (aniq)
    let deletedSize = 0
    let insertedSize = 0
    let deletedChars = 0
    let insertedChars = 0
    const insertedTexts: string[] = []
    const ranges: Array<[number, number]> = []
    const maps = tr.mapping.maps
    tr.steps.forEach((_step, i) => {
      const map = maps[i]
      const before = tr.docs[i]
      const after = i + 1 < tr.docs.length ? tr.docs[i + 1] : tr.doc
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        deletedSize += oldEnd - oldStart
        insertedSize += newEnd - newStart
        if (oldEnd > oldStart) deletedChars += before.textBetween(oldStart, oldEnd, '', '').length
        if (newEnd > newStart) {
          const chars = after.textBetween(newStart, newEnd, '', '').length
          if (chars > 0) {
            insertedChars += chars
            insertedTexts.push(after.textBetween(newStart, newEnd, '\n', ''))
          }
          const rest = tr.mapping.slice(i + 1)
          const a = rest.map(newStart, 1)
          const b = rest.map(newEnd, -1)
          if (b > a) ranges.push([a, b])
        }
      })
    })

    // 2) Manba
    let source: Source
    let runs: Run[] | undefined
    let keepMarks = false
    const explicit = tr.getMeta(SOURCE_META) as Source | undefined
    const ui = tr.getMeta('uiEvent') as string | undefined
    const userRecent = signals.composing || t - signals.lastUserInputAt <= USER_SIGNAL_WINDOW_MS
    // DOM paste/drop/replacement signali faqat bitta tranzaksiyaga tegishli va
    // undan keyingi har qanday klaviatura bosilishi uni bekor qiladi.
    const fresh = (at: number, window: number) =>
      insertedChars > 0 && t - at <= window && at >= signals.lastUserInputAt
    const pasteSignal = fresh(signals.lastPasteAt, CLIPBOARD_SIGNAL_WINDOW_MS)
    const dropSignal = fresh(signals.lastDropAt, CLIPBOARD_SIGNAL_WINDOW_MS)
    const replacementSignal = fresh(signals.lastReplacementAt, USER_SIGNAL_WINDOW_MS)

    if (explicit) {
      source = explicit
    } else if (tr.getMeta(HISTORY_META)) {
      source = 'history'
    } else if (ui === 'cut') {
      source = 'delete'
    } else if (ui === 'paste' || pasteSignal) {
      signals.lastPasteAt = Number.NEGATIVE_INFINITY
      source = 'paste'
      if (insertedChars > 0) {
        const rec = findCopy(clipboardHash(insertedTexts.join('\n')), insertedChars, t)
        if (rec) {
          source = 'moved'
          runs = rec.runs
        }
      }
    } else if (ui === 'drop' || dropSignal) {
      signals.lastDropAt = Number.NEGATIVE_INFINITY
      if (internalDropPending) {
        source = 'moved'
        keepMarks = true
      } else {
        source = 'drop'
      }
      internalDropPending = false
    } else if (replacementSignal) {
      signals.lastReplacementAt = Number.NEGATIVE_INFINITY
      source = 'replacement'
    } else if (!userRecent) {
      source = 'unknown'
    } else if (insertedChars === 0 && deletedChars > 0) {
      source = 'delete'
    } else if (insertedChars >= BULK_THRESHOLD) {
      source = 'bulk_input'
    } else {
      source = 'typing'
    }

    // 3) Mutation yozuvi (faqat hajm o'zgargan bo'lsa; bold/italic kabi
    //    mark-only o'zgarishlar hajmga ta'sir qilmaydi va yozilmaydi)
    let mutation: RawMutation | null = null
    if (deletedSize > 0 || insertedSize > 0) {
      const start = tr.before.content.findDiffStart(tr.doc.content) ?? 0
      const end = tr.before.content.findDiffEnd(tr.doc.content)
      const to = end ? Math.max(start, end.a) : start
      mutation = {
        client_mutation_id: uuid(),
        from: start,
        to,
        deleted_size: deletedSize,
        inserted_size: insertedSize,
        deleted_chars: deletedChars,
        inserted_chars: insertedChars,
        source,
        t,
      }
    }

    const result: Classification = { source, mutation, ranges, runs, keepMarks }
    cache.set(tr, result)
    return result
  }

  function mapRanges(ranges: Array<[number, number]>, tr: Transaction): Array<[number, number]> {
    return ranges
      .map(([a, b]) => [tr.mapping.map(a, 1), tr.mapping.map(b, -1)] as [number, number])
      .filter(([a, b]) => b > a)
  }

  function applyRuns(fix: Transaction, doc: PMNode, [a, b]: [number, number], runs: Run[], type: MarkType) {
    let idx = 0
    let left = runs[0]?.[0] ?? 0
    doc.nodesBetween(a, b, (node, pos) => {
      if (!node.isText) return
      const start = Math.max(a, pos)
      const end = Math.min(b, pos + node.nodeSize)
      let p = start
      while (p < end && idx < runs.length) {
        const take = Math.min(left, end - p)
        const src = runs[idx][1]
        if (src && take > 0) fix.addMark(p, p + take, type.create({ source: src }))
        p += take
        left -= take
        if (left === 0) {
          idx += 1
          left = runs[idx]?.[0] ?? 0
        }
      }
    })
  }

  const plugin = new Plugin({
    key: recorderKey,
    state: {
      init: () => null,
      apply(tr) {
        if (!tr.docChanged) return null
        if (deferredTyping.length) deferredTyping = mapRanges(deferredTyping, tr)
        if (tr.getMeta(FIX_META) || tr.getMeta(SKIP_META)) return null
        const c = classify(tr)
        if (c.mutation) pending.push(c.mutation)
        return null
      },
    },

    appendTransaction(trs, _oldState, newState) {
      const originType = newState.schema.marks.origin
      if (!originType) return null
      const fix = newState.tr

      trs.forEach((tr, k) => {
        if (!tr.docChanged || tr.getMeta(FIX_META) || tr.getMeta(SKIP_META)) return
        const c = cache.get(tr)
        if (!c || !c.ranges.length) return
        // history: hujjat mark'lari bilan oldingi holatga qaytadi; delete: yangi belgi yo'q
        if (c.source === 'history' || c.source === 'delete' || c.keepMarks) return

        let ranges = c.ranges
        for (let j = k + 1; j < trs.length; j++) ranges = mapRanges(ranges, trs[j])

        if (c.source === 'typing') {
          if (signals.composing) {
            deferredTyping.push(...ranges)
            return
          }
          // TZ §10.7: typing — jumladan mark'li matn ichida — origin mark aniq olib tashlanadi
          for (const [a, b] of ranges) fix.removeMark(a, b, originType)
        } else if (c.source === 'moved') {
          // clipboard'dagi origin ma'lumotiga ishonilmaydi: asl run'lar qayta qo'llanadi
          for (const r of ranges) {
            fix.removeMark(r[0], r[1], originType)
            if (c.runs) applyRuns(fix, newState.doc, r, c.runs, originType)
          }
        } else if (isOriginSource(c.source)) {
          const mark = originType.create({ source: c.source })
          for (const [a, b] of ranges) fix.addMark(a, b, mark)
        }
      })

      if (!fix.docChanged) return null
      fix.setMeta(FIX_META, true)
      return fix
    },

    props: {
      handleDOMEvents: {
        copy: (view) => {
          recordCopy(view.state)
          return false
        },
        cut: (view) => {
          recordCopy(view.state)
          return false
        },
      },
      handleDrop: (view) => {
        internalDropPending = !!view.dragging
        return false
      },
    },

    view: () => ({
      update: () => {
        if (!pending.length || !opts.onMutation) return
        const out = pending
        pending = []
        out.forEach((m) => opts.onMutation!(m))
      },
    }),
  })

  return {
    plugin,
    drain() {
      const out = pending
      pending = []
      return out
    },
    applyDeferred(view) {
      if (!deferredTyping.length || signals.composing) return
      const originType = view.state.schema.marks.origin
      const tr = view.state.tr
      for (const [a, b] of deferredTyping) tr.removeMark(a, b, originType)
      deferredTyping = []
      if (!tr.docChanged) return
      tr.setMeta(FIX_META, true).setMeta('addToHistory', false)
      view.dispatch(tr)
    },
    recordCopy,
  }
}

export function originOf(marks: readonly Mark[]): OriginSource | null {
  const m = marks.find((x) => x.type.name === 'origin')
  const src = m?.attrs.source as string | undefined
  return src && isOriginSource(src) ? src : null
}
