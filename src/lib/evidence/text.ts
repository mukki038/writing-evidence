/**
 * Server (Postgres) hisob-kitobining TypeScript nusxasi.
 * Server hisobi yakuniy; bu faqat UI (so'z soni) va testlar uchun.
 */

export interface PMJSON {
  type: string
  text?: string
  content?: PMJSON[]
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const TEXTBLOCKS = new Set(['paragraph', 'heading'])

/** ProseMirror doc.content.size (JS string uzunligi = UTF-16 birliklar) */
export function docSize(doc: PMJSON): number {
  return (doc.content ?? []).reduce((sum, n) => sum + nodeSize(n), 0)
}

function nodeSize(n: PMJSON): number {
  if (n.type === 'text') return (n.text ?? '').length
  return 2 + (n.content ?? []).reduce((sum, c) => sum + nodeSize(c), 0)
}

/** content_text: textblock'lar "\n" bilan (doc.textBetween(0, size, "\n") bilan bir xil), NFC */
export function contentText(doc: PMJSON): string {
  const lines: string[] = []
  const walk = (n: PMJSON) => {
    if (TEXTBLOCKS.has(n.type)) {
      lines.push((n.content ?? []).map((c) => c.text ?? '').join(''))
      return
    }
    ;(n.content ?? []).forEach(walk)
  }
  ;(doc.content ?? []).forEach(walk)
  return lines.join('\n').normalize('NFC')
}

/** TZ §9: bo'shliq bilan ajratilgan tokenlar soni */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length
}

/** Ichki ko'chirish uchun normallashtirilgan hash (TZ §10.6). Kriptografik emas. */
export function clipboardHash(text: string): string {
  const norm = text.normalize('NFC').replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${norm.length}`
}

/**
 * Yolg'iz UTF-16 surrogate'larni U+FFFD bilan almashtiradi (uzunlik o'zgarmaydi,
 * shuning uchun hajm va consistency check aniq qoladi). Postgres jsonb yolg'iz
 * surrogate'ni qabul qilmaydi — busiz bunday saqlash abadiy qayta urinardi.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function wellFormed(s: string): string {
  const f = (s as { toWellFormed?: () => string }).toWellFormed
  return typeof f === 'function' ? f.call(s) : s.replace(LONE_SURROGATE, '\uFFFD')
}

export function wellFormedDeep<T>(value: T): T {
  if (typeof value === 'string') return wellFormed(value) as T
  if (Array.isArray(value)) return value.map(wellFormedDeep) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wellFormedDeep(v)])) as T
  }
  return value
}
