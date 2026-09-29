/**
 * Client ↔ server formatlari (zod). Noma'lum tur yoki ortiqcha maydon rad
 * etiladi (TZ §10.4). Server (Postgres) ham xuddi shu qoidalarni qayta tekshiradi.
 */
import { z } from 'zod'
import { MAX_EVENT_BATCH, MAX_PACKET_MUTATIONS, SOURCES } from './constants'
import { wellFormedDeep } from './text'

const isoTs = z.iso.datetime({ offset: true })
const int0 = z.number().int().min(0).max(2_147_483_647)

export const wireSession = z.strictObject({
  id: z.uuid(),
  started_at: isoTs,
})
export type WireSession = z.infer<typeof wireSession>

export const wireMutation = z.strictObject({
  client_mutation_id: z.uuid(),
  session_id: z.uuid(),
  seq: int0.min(1),
  from: int0,
  to: int0,
  deleted_size: int0,
  inserted_size: int0,
  deleted_chars: int0,
  inserted_chars: int0,
  source: z.enum(SOURCES),
  client_ts: isoTs,
})
export type WireMutation = z.infer<typeof wireMutation>

// content_json tarkibi serverda (private.pm_doc) to'liq tekshiriladi
const pmDoc = z.looseObject({ type: z.literal('doc'), content: z.array(z.unknown()).min(1) })

export const savePacket = z.strictObject({
  base_version: int0,
  content_json: pmDoc,
  mutations: z.array(wireMutation).min(1).max(MAX_PACKET_MUTATIONS),
  sessions: z.array(wireSession).max(50),
})
export type SavePacket = z.infer<typeof savePacket>

export const titleUpdate = z.strictObject({
  title: z.string().trim().max(200),
})

const eventBase = {
  client_event_id: z.uuid(),
  session_id: z.uuid(),
  seq: int0.min(1),
  client_ts: isoTs,
}

export const wireEvent = z.discriminatedUnion('type', [
  z.strictObject({ ...eventBase, type: z.literal('session_start'), payload: z.strictObject({}) }),
  z.strictObject({
    ...eventBase,
    type: z.literal('session_end'),
    payload: z.strictObject({ reason: z.enum(['pagehide', 'idle']) }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('typing_activity'),
    payload: z.strictObject({ typed_chars: int0, deleted_chars: int0, active_sec: int0.max(10) }),
  }),
])
export type WireEvent = z.infer<typeof wireEvent>

export const eventBatch = z.strictObject({
  events: z.array(wireEvent).min(1).max(MAX_EVENT_BATCH),
  sessions: z.array(wireSession).max(50),
})
export type EventBatch = z.infer<typeof eventBatch>

/** save_document javobi */
export type SaveResult =
  | { status: 'ok'; version: number; doc_size: number; word_count: number; snapshot: boolean; unrecorded_change: boolean }
  | { status: 'duplicate'; version: number; current_version: number }
  | { status: 'conflict'; version: number; content_json: Record<string, unknown>; title: string }

/** Route va testlar uchun yagona kirish nuqtasi: zod + yolg'iz surrogate tozalash */
export function parseSavePacket(raw: unknown) {
  return savePacket.safeParse(wellFormedDeep(raw))
}
