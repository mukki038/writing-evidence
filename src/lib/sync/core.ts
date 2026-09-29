/**
 * Sync qatlamining sof (DOM'siz) qismlari: session soati, mutation buferi
 * (coalescing) va typing_activity oynasi. Testlar shu fayl orqali.
 */
import { COALESCE_WINDOW_MS, SESSION_IDLE_MS, type Source } from '../evidence/constants'
import type { RawMutation } from '../evidence/recorder'
import type { WireMutation, WireSession } from '../evidence/wire'

// ---------------------------------------------------------------------------
// Session: id client'da yaratiladi. Hujjat ochilganda boshlanadi; 30 daqiqa
// faoliyatsizlikdan keyin (client vaqti bo'yicha) yangisi ochiladi — offline
// paytda ham.
// ---------------------------------------------------------------------------
export class SessionClock {
  private cur: { id: string; startedAt: number; lastActivity: number; seq: number }

  constructor(
    private uuid: () => string,
    t: number,
  ) {
    this.cur = { id: uuid(), startedAt: t, lastActivity: t, seq: 0 }
  }

  get info(): WireSession {
    return { id: this.cur.id, started_at: new Date(this.cur.startedAt).toISOString() }
  }

  get id(): string {
    return this.cur.id
  }

  isIdle(t: number): boolean {
    return t - this.cur.lastActivity > SESSION_IDLE_MS
  }

  /** Yangi session (idle'dan keyin yoki sahifa bfcache'dan qaytganda) */
  rotate(t: number): void {
    this.cur = { id: this.uuid(), startedAt: t, lastActivity: t, seq: 0 }
  }

  touch(t: number): void {
    this.cur.lastActivity = Math.max(this.cur.lastActivity, t)
  }

  nextSeq(): number {
    this.cur.seq += 1
    return this.cur.seq
  }
}

// ---------------------------------------------------------------------------
// Mutation buferi — TZ §10.9 coalescing: bir joyda ketma-ket typing (≤ 2 s)
// bitta mutation'ga birlashadi. Hajm yig'indilari har doim aniq saqlanadi.
// ---------------------------------------------------------------------------
export interface PendingMutation extends WireMutation {
  lastT: number
}

const MERGEABLE: ReadonlySet<Source> = new Set(['typing', 'delete'])

export function tryMerge(p: PendingMutation, m: RawMutation, sessionId: string): boolean {
  if (p.session_id !== sessionId || p.source !== m.source || !MERGEABLE.has(m.source)) return false
  if (m.t - p.lastT > COALESCE_WINDOW_MS || m.t < p.lastT) return false

  if (m.source === 'typing') {
    // yangi belgi oldingi kiritishning oxiriga yaqin yozilgan, hech narsa o'chirilmagan
    if (m.deleted_size !== 0 || p.deleted_size !== 0) return false
    if (Math.abs(m.from - (p.from + p.inserted_size)) > 2) return false
  } else {
    // backspace (oldinga) yoki delete (orqaga) ketma-ketligi
    if (m.inserted_size !== 0 || p.inserted_size !== 0) return false
    const backspace = Math.abs(m.to - p.from) <= 1
    const forward = Math.abs(m.from - p.from) <= 1
    if (!backspace && !forward) return false
    if (backspace) p.from = Math.min(p.from, m.from)
    else p.to = p.to + (m.to - m.from)
  }
  p.deleted_size += m.deleted_size
  p.inserted_size += m.inserted_size
  p.deleted_chars += m.deleted_chars
  p.inserted_chars += m.inserted_chars
  p.lastT = m.t
  return true
}

export function toPending(m: RawMutation, sessionId: string, seq: number): PendingMutation {
  return {
    client_mutation_id: m.client_mutation_id,
    session_id: sessionId,
    seq,
    from: m.from,
    to: m.to,
    deleted_size: m.deleted_size,
    inserted_size: m.inserted_size,
    deleted_chars: m.deleted_chars,
    inserted_chars: m.inserted_chars,
    source: m.source,
    client_ts: new Date(m.t).toISOString(),
    lastT: m.t,
  }
}

export function toWire(p: PendingMutation): WireMutation {
  const { lastT: _lastT, ...wire } = p
  return wire
}

// ---------------------------------------------------------------------------
// typing_activity: 10 soniyalik oyna (TZ §10.1, §10.3)
// active_sec = oynada kamida bitta tahrir bo'lgan soniyalar soni
// ---------------------------------------------------------------------------
export interface ActivityWindowResult {
  windowEnd: number
  typed_chars: number
  deleted_chars: number
  active_sec: number
}

const ACTIVE_SOURCES: ReadonlySet<Source> = new Set(['typing', 'delete', 'history', 'moved', 'bulk_input'])
const WINDOW_MS = 10_000

export class ActivityWindow {
  private start: number | null = null
  private typed = 0
  private deleted = 0
  private seconds = new Set<number>()

  add(m: RawMutation): ActivityWindowResult | null {
    if (!ACTIVE_SOURCES.has(m.source)) return null
    const ws = Math.floor(m.t / WINDOW_MS) * WINDOW_MS
    let done: ActivityWindowResult | null = null
    if (this.start !== null && ws !== this.start) done = this.close()
    this.start = ws
    if (m.source === 'typing') this.typed += m.inserted_chars
    if (m.source === 'typing' || m.source === 'delete') this.deleted += m.deleted_chars
    this.seconds.add(Math.floor(m.t / 1000))
    return done
  }

  /** Oyna tugagan bo'lsa (yoki force) — yopadi */
  flush(t: number, force = false): ActivityWindowResult | null {
    if (this.start === null) return null
    if (!force && t < this.start + WINDOW_MS) return null
    return this.close()
  }

  private close(): ActivityWindowResult | null {
    if (this.start === null) return null
    const r: ActivityWindowResult = {
      windowEnd: this.start + WINDOW_MS,
      typed_chars: this.typed,
      deleted_chars: this.deleted,
      active_sec: Math.min(10, this.seconds.size),
    }
    this.start = null
    this.typed = 0
    this.deleted = 0
    this.seconds.clear()
    return r
  }
}
