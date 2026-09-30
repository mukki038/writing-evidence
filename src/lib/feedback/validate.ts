/**
 * LLM javobini tekshirish (sof funksiyalar, testlanadi).
 * LLM keltirgan excerpt matnda AYNAN topilishi shart — topilmasa flag tashlanadi.
 */
import { CATEGORIES, MAX_EXCERPT, MAX_FLAGS, type Category, type Flag } from './types'

export interface RawFlag {
  excerpt?: unknown
  category?: unknown
  reason?: unknown
}

/** Tipografik farqlarni (qo'shtirnoq, tire, bo'shliq) hisobga olmay qidirish uchun */
function normChar(c: string): string {
  if (/[‘’‚‛′]/.test(c)) return "'"
  if (/[“”„‟″]/.test(c)) return '"'
  if (/[‐-―−]/.test(c)) return '-'
  if (/\s/.test(c)) return ' '
  return c
}

function normalize(s: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let prevSpace = false
  for (let i = 0; i < s.length; i++) {
    const c = normChar(s[i])
    if (c === ' ') {
      if (prevSpace) continue
      prevSpace = true
    } else prevSpace = false
    norm += c
    map.push(i)
  }
  return { norm, map }
}

/** Matnda excerpt'ni topadi (avval aniq, keyin yumshoq). [start, end) yoki null. */
export function findExcerpt(text: string, excerpt: string, from = 0): [number, number] | null {
  const exact = text.indexOf(excerpt, from)
  if (exact >= 0) return [exact, exact + excerpt.length]
  const t = normalize(text)
  const e = normalize(excerpt.trim()).norm
  if (!e) return null
  const startNorm = t.map.findIndex((orig) => orig >= from)
  if (startNorm < 0) return null
  const i = t.norm.indexOf(e, startNorm)
  if (i < 0) return null
  return [t.map[i], t.map[i + e.length - 1] + 1]
}

export function locateFlags(text: string, raw: unknown): Flag[] {
  if (!Array.isArray(raw)) return []
  const out: Flag[] = []
  for (const r of raw as RawFlag[]) {
    if (out.length >= MAX_FLAGS) break
    if (!r || typeof r.excerpt !== 'string' || typeof r.reason !== 'string') continue
    if (!CATEGORIES.includes(r.category as Category)) continue
    const excerpt = r.excerpt.trim()
    if (excerpt.length < 3 || excerpt.length > MAX_EXCERPT) continue
    const reason = r.reason.trim().slice(0, 400)
    if (!reason) continue

    // bir xil parcha bir necha marta uchrasa — hali band bo'lmagan birinchisi
    let pos = 0
    let hit: [number, number] | null = null
    while ((hit = findExcerpt(text, excerpt, pos))) {
      const [s, e] = hit
      if (!out.some((f) => s < f.end && e > f.start)) break
      pos = s + 1
    }
    if (!hit) continue
    const [start, end] = hit
    const actual = text.slice(start, end)
    if (actual.includes('\n')) continue // bitta paragraf ichida bo'lishi shart
    out.push({ excerpt: actual, category: r.category as Category, reason, start, end })
  }
  return out.sort((a, b) => a.start - b.start)
}

export function cleanVariants(excerpt: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const seen = new Set([key(excerpt)])
  const maxLen = Math.max(excerpt.length * 3, excerpt.length + 200)
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    let s = v.replace(/\s*\n+\s*/g, ' ').trim()
    // modelning o'rab qo'ygan qo'shtirnoqlari (asl parchada bo'lmasa)
    if (/^["“].*["”]$/.test(s) && !/^["“]/.test(excerpt)) s = s.slice(1, -1).trim()
    if (!s || s.length > maxLen) continue
    const k = key(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length === 3) break
  }
  return out
}
