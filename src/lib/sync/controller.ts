/**
 * Autosave + offline navbat + event navbati (TZ v4 §10.9, §11, §12).
 *
 *  - Autosave = bitta so'rov: {base_version, content_json, mutations[], sessions[]}.
 *  - Paketlar IndexedDB'da navbatda turadi va tartib bilan yuboriladi; har bir
 *    paketning base_version'i oldingisidan +1 (server har saqlashda versiyani
 *    aynan 1 ga oshiradi).
 *  - 409 → local holat "Recovered draft", server versiyasi yuklanadi.
 *  - Xato editorni hech qachon bloklamaydi.
 */
import {
  COALESCE_WINDOW_MS,
  MAX_EVENT_BATCH,
  PACKET_FREEZE_AT,
} from '../evidence/constants'
import type { RawMutation } from '../evidence/recorder'
import { wellFormedDeep, type PMJSON } from '../evidence/text'
import type { SaveResult, WireEvent, WireSession } from '../evidence/wire'
import { ActivityWindow, SessionClock, toPending, toWire, tryMerge, type ActivityWindowResult, type PendingMutation } from './core'
import type { DeviceStore, Packet, QueuedEvent } from './store'

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error' | 'conflict'

export interface ServerDoc {
  version: number
  content_json: PMJSON
  title: string
}

export interface SyncOptions {
  documentId: string
  baseVersion: number
  getContent: () => PMJSON
  store: DeviceStore
  onStatus: (s: SyncStatus, detail?: string) => void
  onConflict: (server: ServerDoc) => void
  onSaved?: (r: { version: number; word_count?: number }) => void
  initialOutbox?: Packet[]
  fetch?: typeof fetch
  now?: () => number
  uuid?: () => string
  debounceMs?: number
  apiBase?: string
}

const KEEPALIVE_LIMIT = 60_000

export class EvidenceSync {
  private outbox: Packet[]
  private pending: PendingMutation[] = []
  private events: QueuedEvent[] = []
  private nextBase: number
  private session: SessionClock
  private sessions = new Map<string, WireSession>()
  private activity = new ActivityWindow()
  private flushing: Promise<void> | null = null
  private eventsFlushing: Promise<void> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private tickTimer: ReturnType<typeof setInterval> | undefined
  private backoffMs = 0
  private persistChain: Promise<void> = Promise.resolve()
  private stopped = false
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly api: string

  constructor(private o: SyncOptions) {
    this.fetchImpl = o.fetch ?? ((...a) => fetch(...a))
    this.now = o.now ?? (() => Date.now())
    this.uuid = o.uuid ?? (() => crypto.randomUUID())
    this.api = `${o.apiBase ?? ''}/api/documents/${o.documentId}`
    this.outbox = [...(o.initialOutbox ?? [])]
    this.nextBase = this.outbox.length
      ? this.outbox[this.outbox.length - 1].base_version + 1
      : o.baseVersion
    this.session = new SessionClock(this.uuid, this.now())
    this.sessions.set(this.session.id, this.session.info)
  }

  // -------------------------------------------------------------------------
  // Hayot sikli
  // -------------------------------------------------------------------------
  async start(): Promise<void> {
    this.events = await this.o.store.getEvents(this.o.documentId).catch(() => [])
    this.enqueueEvent('session_start', {}, this.now())
    this.tickTimer = setInterval(() => this.tick(), 5000)
    void this.flushEvents()
    if (this.outbox.length) void this.flush()
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.tickTimer)
    clearTimeout(this.retryTimer)
    clearTimeout(this.debounceTimer)
  }

  hasUnsaved(): boolean {
    return this.pending.length > 0 || this.outbox.length > 0
  }

  get sessionId(): string {
    return this.session.id
  }

  /** Recorder'dan kelgan har bir mutation */
  onMutation(raw: RawMutation): void {
    if (this.stopped) return
    if (this.session.isIdle(raw.t)) {
      // 30 daqiqa faoliyatsizlik: eski session'ning faolligi yopiladi, yangisi ochiladi
      this.pushActivity(this.activity.flush(raw.t, true), raw.t)
      this.session.rotate(raw.t)
      this.sessions.set(this.session.id, this.session.info)
      this.enqueueEvent('session_start', {}, raw.t)
    }
    this.session.touch(raw.t)

    const last = this.pending[this.pending.length - 1]
    if (!last || !tryMerge(last, raw, this.session.id)) {
      this.pending.push(toPending(raw, this.session.id, this.session.nextSeq()))
    }
    this.pushActivity(this.activity.add(raw), raw.t)

    this.o.onStatus('saving')
    if (this.pending.length >= PACKET_FREEZE_AT) void this.saveNow()
    else this.debounce()
  }

  /** Oyna fokusni yo'qotganda / sahifa yashirilganda */
  saveNow(): Promise<void> {
    clearTimeout(this.debounceTimer)
    this.freeze()
    return this.flush()
  }

  /** pagehide: session yopiladi, hammasi qurilmada; imkon bo'lsa keepalive bilan yuboriladi */
  pagehide(): void {
    const t = this.now()
    this.pushActivity(this.activity.flush(t, true), t)
    this.enqueueEvent('session_end', { reason: 'pagehide' }, t)
    this.freeze()
    this.sendKeepalive()
  }

  /** bfcache'dan qaytish: yangi session */
  resume(): void {
    const t = this.now()
    this.session.rotate(t)
    this.sessions.set(this.session.id, this.session.info)
    this.enqueueEvent('session_start', {}, t)
    void this.flushEvents()
  }

  /** Internet qaytdi — kutmasdan yuborish */
  online(): void {
    this.backoffMs = 0
    clearTimeout(this.retryTimer)
    void this.flush()
    void this.flushEvents()
  }

  /** 409 dan keyin editor server versiyasi bilan qayta yaratilganda */
  rebase(version: number): void {
    this.pending = []
    this.outbox = []
    this.persist()
    this.nextBase = version
  }

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------
  private debounce(): void {
    clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.saveNow(), this.o.debounceMs ?? COALESCE_WINDOW_MS)
  }

  private freeze(): void {
    if (!this.pending.length) return
    const mutations = this.pending.map(toWire)
    this.pending = []
    const ids = [...new Set(mutations.map((m) => m.session_id))]
    const packet: Packet = {
      packet_id: this.uuid(),
      base_version: this.nextBase,
      content_json: wellFormedDeep(this.o.getContent()),
      mutations,
      sessions: ids.map((id) => this.sessions.get(id)!).filter(Boolean),
      created_at: this.now(),
    }
    this.nextBase += 1
    this.outbox.push(packet)
    this.persist()
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = (async () => {
      try {
        while (this.outbox.length && !this.stopped) {
          const p = this.outbox[0]
          this.o.onStatus('saving')
          let res: Response
          try {
            res = await this.fetchImpl(this.api, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: packetBody(p),
            })
          } catch {
            this.scheduleRetry('offline')
            return
          }
          if (res.status === 200) {
            const r = (await res.json()) as SaveResult
            if (this.outbox[0] === p) this.outbox.shift()
            this.persist()
            this.backoffMs = 0
            this.o.onSaved?.({ version: r.version, word_count: r.status === 'ok' ? r.word_count : undefined })
            continue
          }
          if (res.status === 409) {
            const r = (await res.json()) as Extract<SaveResult, { status: 'conflict' }>
            await this.handleConflict({ version: r.version, content_json: r.content_json as unknown as PMJSON, title: r.title })
            return
          }
          if (res.status === 401) {
            this.scheduleRetry('error', 'auth')
            return
          }
          if (res.status >= 500 || res.status === 429) {
            this.scheduleRetry('error', `http_${res.status}`)
            return
          }
          // boshqa 4xx: paket rad etildi — server holatidan tiklanadi
          await this.recoverFromServer()
          return
        }
        if (!this.pending.length && !this.stopped) this.o.onStatus('saved')
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  private scheduleRetry(status: 'offline' | 'error', detail?: string): void {
    this.o.onStatus(status, detail)
    this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, 60_000) : 2000
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.flush(), this.backoffMs)
  }

  private async handleConflict(server: ServerDoc): Promise<void> {
    await this.o.store
      .setDraft(this.o.documentId, { content_json: this.o.getContent(), saved_at: this.now() })
      .catch(() => undefined)
    this.rebase(server.version)
    this.o.onStatus('conflict')
    this.o.onConflict(server)
  }

  private async recoverFromServer(): Promise<void> {
    try {
      const res = await this.fetchImpl(this.api, { method: 'GET' })
      if (!res.ok) throw new Error(String(res.status))
      const d = (await res.json()) as { version: number; content_json: PMJSON; title: string }
      await this.handleConflict({ version: d.version, content_json: d.content_json, title: d.title })
    } catch {
      this.scheduleRetry('error', 'rejected')
    }
  }

  private persist(): void {
    const snapshot = [...this.outbox]
    this.persistChain = this.persistChain
      .then(() => this.o.store.setOutbox(this.o.documentId, snapshot))
      .catch(() => undefined)
  }

  // -------------------------------------------------------------------------
  // Event'lar (session, typing_activity) — hech qachon yozishni bloklamaydi
  // -------------------------------------------------------------------------
  private tick(): void {
    const t = this.now()
    this.pushActivity(this.activity.flush(t), t)
    void this.flushEvents()
  }

  private pushActivity(w: ActivityWindowResult | null, t: number): void {
    if (!w) return
    this.enqueueEvent(
      'typing_activity',
      { typed_chars: w.typed_chars, deleted_chars: w.deleted_chars, active_sec: w.active_sec },
      Math.min(w.windowEnd, t),
    )
  }

  private enqueueEvent<T extends WireEvent['type']>(
    type: T,
    payload: Extract<WireEvent, { type: T }>['payload'],
    t: number,
  ): void {
    const event = {
      client_event_id: this.uuid(),
      session_id: this.session.id,
      seq: this.session.nextSeq(),
      client_ts: new Date(t).toISOString(),
      type,
      payload,
    } as WireEvent
    this.events.push({ event, session: this.session.info })
    this.persistEvents()
    if (this.events.length >= 50) void this.flushEvents()
  }

  private persistEvents(): void {
    const snapshot = [...this.events]
    this.persistChain = this.persistChain
      .then(() => this.o.store.setEvents(this.o.documentId, snapshot))
      .catch(() => undefined)
  }

  flushEvents(): Promise<void> {
    if (this.eventsFlushing) return this.eventsFlushing
    if (!this.events.length || this.stopped) return Promise.resolve()
    this.eventsFlushing = (async () => {
      try {
        const batch = this.events.slice(0, MAX_EVENT_BATCH)
        const res = await this.fetchImpl(`${this.api}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: eventsBody(batch),
        })
        const drop = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429)
        if (drop) {
          const sent = new Set(batch.map((b) => b.event.client_event_id))
          this.events = this.events.filter((e) => !sent.has(e.event.client_event_id))
          this.persistEvents()
        }
      } catch {
        // tarmoq yo'q — navbatda qoladi
      } finally {
        this.eventsFlushing = null
      }
    })()
    return this.eventsFlushing
  }

  private sendKeepalive(): void {
    // Hammasi allaqachon IndexedDB'da; bu faqat tezroq yetkazish urinishi.
    try {
      const first = this.outbox[0]
      if (first && !this.flushing) {
        const body = packetBody(first)
        if (body.length < KEEPALIVE_LIMIT) {
          void this.fetchImpl(this.api, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => undefined)
        }
      }
      if (this.events.length) {
        const body = eventsBody(this.events.slice(0, MAX_EVENT_BATCH))
        if (body.length < KEEPALIVE_LIMIT && typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(`${this.api}/events`, new Blob([body], { type: 'application/json' }))
        }
      }
    } catch {
      /* best effort */
    }
  }
}

function packetBody(p: Packet): string {
  return JSON.stringify({
    base_version: p.base_version,
    content_json: p.content_json,
    mutations: p.mutations,
    sessions: p.sessions,
  })
}

function eventsBody(batch: QueuedEvent[]): string {
  const sessions = [...new Map(batch.map((b) => [b.session.id, b.session])).values()]
  return JSON.stringify({ events: batch.map((b) => b.event), sessions })
}

/**
 * Sahifa ochilganda: oldingi tashrifdan qolgan saqlanmagan paketlarni
 * hujjatni yuklashdan OLDIN yuborish.
 */
export async function drainOutbox(
  documentId: string,
  store: DeviceStore,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ result: 'ok' | 'conflict' | 'offline'; outbox: Packet[] }> {
  const packets = await store.getOutbox(documentId).catch(() => [] as Packet[])
  const api = `/api/documents/${documentId}`
  while (packets.length) {
    let res: Response
    try {
      res = await fetchImpl(api, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: packetBody(packets[0]),
      })
    } catch {
      return { result: 'offline', outbox: packets }
    }
    if (res.status === 200) {
      packets.shift()
      await store.setOutbox(documentId, packets).catch(() => undefined)
      continue
    }
    if (res.status >= 500 || res.status === 429 || res.status === 401) {
      return { result: 'offline', outbox: packets }
    }
    // 409 yoki rad etilgan paket: eng oxirgi local holat — Recovered draft
    const latest = packets[packets.length - 1]
    await store.setDraft(documentId, { content_json: latest.content_json, saved_at: latest.created_at }).catch(() => undefined)
    await store.setOutbox(documentId, []).catch(() => undefined)
    return { result: 'conflict', outbox: [] }
  }
  return { result: 'ok', outbox: [] }
}
