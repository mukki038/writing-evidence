/**
 * Timeline ma'lumoti — document_timeline() SQL funksiyasi qaytaradigan shakl.
 * Demo sahifa ham xuddi shu shaklni brauzerda quradi.
 */
import { isOriginSource } from './constants'

export interface TimelineSession {
  id: string
  started_at: string
  last_activity_at: string
  ended_at: string | null
  active_sec: number
  mutation_count: number
}

export interface TimelineEvent {
  type: 'text_inserted' | 'text_moved' | 'revision' | 'unrecorded_change'
  effective_ts: string
  payload: Record<string, unknown>
  offline: boolean
  clock_adjusted: boolean
}

export interface TimelineData {
  document: { title: string; created_at: string; word_count: number }
  sessions: TimelineSession[]
  snapshots: Array<{ document_version: number; word_count: number; created_at: string; reason: string }>
  events: TimelineEvent[]
  offline_ranges: Array<{ session_id: string; started_at: string; ended_at: string; synced_at: string; mutations: number }>
  clock_adjusted: number
  mutation_count: number
}

export interface TimelineSummary {
  firstWriting: string | null
  lastWriting: string | null
  sessions: number
  activeSec: number
  words: number
  externalInserts: number
  externalChars: number
  moves: number
  revisions: number
  unrecorded: number
  offlineRanges: number
  offlineSec: number
  clockAdjusted: number
}

/** TZ §17 formulalari (A0 uchun asosiylari) */
export function summarize(d: TimelineData): TimelineSummary {
  const starts = d.sessions.map((s) => s.started_at).sort()
  const ends = d.sessions.map((s) => s.ended_at ?? s.last_activity_at).sort()
  const ext = d.events.filter(
    (e) =>
      e.type === 'text_inserted' &&
      isOriginSource(String(e.payload.source)) &&
      Number(e.payload.inserted_chars) >= 40,
  )
  return {
    firstWriting: starts[0] ?? null,
    lastWriting: ends[ends.length - 1] ?? null,
    sessions: d.sessions.length,
    activeSec: d.sessions.reduce((a, s) => a + (s.active_sec ?? 0), 0),
    words: d.document.word_count,
    externalInserts: ext.length,
    externalChars: ext.reduce((a, e) => a + Number(e.payload.inserted_chars), 0),
    moves: d.events.filter((e) => e.type === 'text_moved').length,
    revisions: d.events.filter((e) => e.type === 'revision').length,
    unrecorded: d.events.filter((e) => e.type === 'unrecorded_change').length,
    offlineRanges: d.offline_ranges.length,
    offlineSec: d.offline_ranges.reduce(
      (a, r) => a + Math.max(0, (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000),
      0,
    ),
    clockAdjusted: d.clock_adjusted,
  }
}

export function formatDuration(sec: number, t: { min: string; sec: string }): string {
  const s = Math.round(sec)
  if (s < 60) return `${s} ${t.sec}`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${m} ${t.min}` : `${m} ${t.min}`
}
