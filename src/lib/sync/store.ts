/**
 * Qurilmadagi saqlash (IndexedDB). Saqlanmagan autosave paketlari, event
 * navbati va "Recovered draft" shu yerda turadi (TZ §11, §12).
 * IndexedDB mavjud bo'lmasa (masalan, ba'zi private rejimlar) — xotirada.
 */
import { createStore, get, set, del, type UseStore } from 'idb-keyval'
import type { PMJSON } from '../evidence/text'
import type { WireEvent, WireMutation, WireSession } from '../evidence/wire'

export interface Packet {
  packet_id: string
  base_version: number
  content_json: PMJSON
  mutations: WireMutation[]
  sessions: WireSession[]
  created_at: number
}

export interface QueuedEvent {
  event: WireEvent
  session: WireSession
}

export interface RecoveredDraft {
  content_json: PMJSON
  saved_at: number
}

export interface DeviceStore {
  getOutbox(docId: string): Promise<Packet[]>
  setOutbox(docId: string, packets: Packet[]): Promise<void>
  getEvents(docId: string): Promise<QueuedEvent[]>
  setEvents(docId: string, events: QueuedEvent[]): Promise<void>
  getDraft(docId: string): Promise<RecoveredDraft | undefined>
  setDraft(docId: string, draft: RecoveredDraft): Promise<void>
  deleteDraft(docId: string): Promise<void>
}

export function memoryStore(): DeviceStore {
  const m = new Map<string, unknown>()
  return {
    getOutbox: async (id) => structuredClone((m.get(`outbox:${id}`) as Packet[]) ?? []),
    setOutbox: async (id, p) => void m.set(`outbox:${id}`, structuredClone(p)),
    getEvents: async (id) => structuredClone((m.get(`events:${id}`) as QueuedEvent[]) ?? []),
    setEvents: async (id, e) => void m.set(`events:${id}`, structuredClone(e)),
    getDraft: async (id) => structuredClone(m.get(`draft:${id}`) as RecoveredDraft | undefined),
    setDraft: async (id, d) => void m.set(`draft:${id}`, structuredClone(d)),
    deleteDraft: async (id) => void m.delete(`draft:${id}`),
  }
}

let cached: DeviceStore | null = null

export function deviceStore(): DeviceStore {
  if (cached) return cached
  if (typeof indexedDB === 'undefined') return (cached = memoryStore())
  let idb: UseStore
  try {
    idb = createStore('writing-evidence', 'kv')
  } catch {
    return (cached = memoryStore())
  }
  cached = {
    getOutbox: async (id) => (await get<Packet[]>(`outbox:${id}`, idb)) ?? [],
    setOutbox: (id, p) => (p.length ? set(`outbox:${id}`, p, idb) : del(`outbox:${id}`, idb)),
    getEvents: async (id) => (await get<QueuedEvent[]>(`events:${id}`, idb)) ?? [],
    setEvents: (id, e) => (e.length ? set(`events:${id}`, e, idb) : del(`events:${id}`, idb)),
    getDraft: (id) => get<RecoveredDraft>(`draft:${id}`, idb),
    setDraft: (id, d) => set(`draft:${id}`, d, idb),
    deleteDraft: (id) => del(`draft:${id}`, idb),
  }
  return cached
}
