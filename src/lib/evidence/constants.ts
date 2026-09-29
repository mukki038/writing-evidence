/** Mutation manbalari (TZ v4 §10.5). Har bir mutation aynan bittasini oladi. */
export const SOURCES = [
  'typing',
  'paste',
  'drop',
  'replacement',
  'bulk_input',
  'unknown',
  'history',
  'ai',
  'recovered',
  'moved',
  'delete',
] as const
export type Source = (typeof SOURCES)[number]

/** Origin mark oladigan manbalar (TZ §10.7). Typed matn mark'siz qoladi. */
export const ORIGIN_SOURCES = ['paste', 'drop', 'replacement', 'bulk_input', 'unknown', 'ai', 'recovered'] as const
export type OriginSource = (typeof ORIGIN_SOURCES)[number]

export function isOriginSource(s: string): s is OriginSource {
  return (ORIGIN_SOURCES as readonly string[]).includes(s)
}

/** Tranzaksiya meta kalitlari */
export const SOURCE_META = 'evidence.source' // o'z kodimiz manbani aniq belgilaydi (ai, recovered, toolbar)
export const SKIP_META = 'evidence.skip' // yuklash (setContent) — ledger'ga yozilmaydi
export const FIX_META = 'evidence.originFix' // origin mark tuzatish tranzaksiyasi
export const HISTORY_META = 'history$' // prosemirror-history PluginKey("history")

/** TZ §10.5: bitta insertText/composition tranzaksiyasi ≥ 40 belgi → bulk_input */
export const BULK_THRESHOLD = 40
/** Klaviatura/IME signali shu oraliqda bo'lsa, o'zgarish user kiritishi hisoblanadi */
export const USER_SIGNAL_WINDOW_MS = 500
/** DOM paste/drop signali uchun oraliq (boshqa plugin paste'ni o'zi bajarsa) */
export const CLIPBOARD_SIGNAL_WINDOW_MS = 300
/** TZ §10.6: oxirgi 20 ta nusxa, 60 daqiqa */
export const COPY_HISTORY_SIZE = 20
export const COPY_TTL_MS = 60 * 60 * 1000
/** TZ §10.9: bir joyda ketma-ket typing (oraliq ≤ 2 s) bitta mutation'ga */
export const COALESCE_WINDOW_MS = 2000
/** TZ §10.1 */
export const SESSION_IDLE_MS = 30 * 60 * 1000
/** TZ §24 */
export const MAX_PACKET_MUTATIONS = 5000
export const PACKET_FREEZE_AT = 4000
export const MAX_PACKET_BYTES = 1_000_000
export const MAX_EVENT_BATCH = 200
export const HARD_WORD_LIMIT = 30000
export const SOFT_WORD_LIMIT = 15000
