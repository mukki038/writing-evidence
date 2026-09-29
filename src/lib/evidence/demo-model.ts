/**
 * Demo rejimi: serverdagi save_document qoidalarining brauzerdagi nusxasi
 * (derived event'lar, snapshot namunalari, faol vaqt). Hech narsa yuborilmaydi.
 */
import { BULK_THRESHOLD, isOriginSource, type Source } from './constants'
import type { RawMutation } from './recorder'
import type { TimelineData, TimelineEvent } from './timeline'

const ACTIVE: ReadonlySet<Source> = new Set(['typing', 'delete', 'history', 'moved', 'bulk_input'])

export interface ActivityItem {
  source: Source
  inserted_chars: number
  deleted_chars: number
  t: number
}

export class DemoModel {
  readonly startedAt = Date.now()
  private events: TimelineEvent[] = []
  private seconds = new Set<number>()
  private lastAt = this.startedAt
  private count = 0
  private points: Array<{ t: number; w: number }> = [{ t: this.startedAt, w: 0 }]
  private lastWords = 0
  recent: ActivityItem[] = []

  add(m: RawMutation): void {
    this.count += 1
    this.lastAt = m.t
    if (ACTIVE.has(m.source)) this.seconds.add(Math.floor(m.t / 1000))
    const ts = new Date(m.t).toISOString()
    const base = { effective_ts: ts, offline: false, clock_adjusted: false }
    if (isOriginSource(m.source) && m.inserted_chars > 0) {
      this.events.push({ ...base, type: 'text_inserted', payload: { source: m.source, inserted_chars: m.inserted_chars } })
    } else if (m.source === 'moved' && m.inserted_chars > 0) {
      this.events.push({ ...base, type: 'text_moved', payload: { inserted_chars: m.inserted_chars } })
    }
    if (m.deleted_chars >= 50) {
      this.events.push({ ...base, type: 'revision', payload: { deleted_chars: m.deleted_chars, inserted_chars: m.inserted_chars } })
    }

    // So'nggi amallar ro'yxati: ketma-ket bir xil manbali typing/delete birlashtiriladi
    const last = this.recent[0]
    if (last && last.source === m.source && (m.source === 'typing' || m.source === 'delete') && m.t - last.t < 5000) {
      last.inserted_chars += m.inserted_chars
      last.deleted_chars += m.deleted_chars
      last.t = m.t
    } else {
      this.recent.unshift({ source: m.source, inserted_chars: m.inserted_chars, deleted_chars: m.deleted_chars, t: m.t })
      this.recent = this.recent.slice(0, 8)
    }
    this.external = this.external || (isOriginSource(m.source) && (m.inserted_chars >= BULK_THRESHOLD || m.source === 'ai'))
  }

  private external = false

  /** So'z soni namunasi (serverdagi snapshot qoidasining tezlashtirilgan varianti) */
  sample(words: number): void {
    const now = Date.now()
    const lastPoint = this.points[this.points.length - 1]
    if (words === this.lastWords && !this.external) return
    if (this.external || now - lastPoint.t >= 3000) {
      this.points.push({ t: now, w: words })
      this.external = false
    } else {
      lastPoint.w = words
    }
    this.lastWords = words
  }

  data(title: string): TimelineData {
    return {
      document: { title, created_at: new Date(this.startedAt).toISOString(), word_count: this.lastWords },
      sessions: [
        {
          id: 'demo',
          started_at: new Date(this.startedAt).toISOString(),
          last_activity_at: new Date(this.lastAt).toISOString(),
          ended_at: null,
          active_sec: this.seconds.size,
          mutation_count: this.count,
        },
      ],
      snapshots: this.points.map((p, i) => ({
        document_version: i,
        word_count: p.w,
        created_at: new Date(p.t).toISOString(),
        reason: 'interval',
      })),
      events: [...this.events],
      offline_ranges: [],
      clock_adjusted: 0,
      mutation_count: this.count,
    }
  }
}
