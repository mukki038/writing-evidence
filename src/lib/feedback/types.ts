/**
 * AI writing feedback — client va server uchun umumiy turlar (TZ v4 MVP-B).
 * AI-likeness / "AI yoki inson" bahosi YO'Q (TZ §7). Faqat yozuv sifati.
 */
import { z } from 'zod'

export const CATEGORIES = ['grammar', 'clarity', 'repetition', 'academic_style', 'citation'] as const
export type Category = (typeof CATEGORIES)[number]

export const MIN_WORDS = 20
export const MAX_WORDS = 1500
export const MAX_CHARS = 12_000
export const MAX_FLAGS = 10
export const MAX_EXCERPT = 600

const locale = z.enum(['uz', 'en'])

export const analyzeRequest = z.strictObject({
  text: z.string().min(1).max(MAX_CHARS),
  locale,
})

export const variantsRequest = z.strictObject({
  excerpt: z.string().min(1).max(MAX_EXCERPT),
  category: z.enum(CATEGORIES),
  reason: z.string().max(500),
  before: z.string().max(800),
  after: z.string().max(800),
  locale,
})

/** start/end — yuborilgan matndagi belgi indekslari */
export interface Flag {
  excerpt: string
  category: Category
  reason: string
  start: number
  end: number
}

export interface AnalyzeResponse {
  flags: Flag[]
  summary: string
}

export interface VariantsResponse {
  variants: string[]
}

export type FeedbackError =
  | 'not_configured'
  | 'rate_limited'
  | 'too_short'
  | 'too_long'
  | 'invalid'
  | 'upstream'
  | 'forbidden'

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
