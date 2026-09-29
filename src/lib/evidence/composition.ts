/**
 * Final matn tarkibi (TZ §10.7, §17): har bir belgi aynan bitta toifaga tegishli.
 * Typed = origin mark'siz matn. Ma'lumot bo'lmasa — null ("mavjud emas"),
 * taxminiy foiz qaytarilmaydi.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { ORIGIN_SOURCES, isOriginSource, type OriginSource } from './constants'
import type { PMJSON } from './text'
import { originOf } from './recorder'

export type Composition = Record<'typed' | OriginSource, number>

export function composition(doc: PMNode): Composition {
  const out = Object.fromEntries([['typed', 0], ...ORIGIN_SOURCES.map((s) => [s, 0])]) as Composition
  doc.descendants((node) => {
    if (!node.isText) return
    const src = originOf(node.marks)
    out[src ?? 'typed'] += node.text!.length
  })
  return out
}

export function compositionPercent(c: Composition): Record<string, number> | null {
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10]))
}

/** Serverda (JSON'dan) — timeline sahifasi uchun */
export function compositionFromJSON(doc: PMJSON): Composition {
  const out = Object.fromEntries([['typed', 0], ...ORIGIN_SOURCES.map((s) => [s, 0])]) as Composition
  const walk = (n: PMJSON) => {
    if (n.type === 'text') {
      const m = n.marks?.find((x) => x.type === 'origin')
      const src = m?.attrs?.source
      const key = typeof src === 'string' && isOriginSource(src) ? src : 'typed'
      out[key] += (n.text ?? '').length
      return
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}
