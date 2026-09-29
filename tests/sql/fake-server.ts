/**
 * Soxta server: EvidenceSync'ning fetch so'rovlarini route'lar bilan bir xil
 * mantiq orqali PGlite'dagi save_document / ingest_events ga yo'naltiradi.
 * Shunday qilib butun zanjir (recorder → sync → zod → SQL) tekshiriladi.
 */
import type { PGlite } from '@electric-sql/pglite'
import { eventBatch, parseSavePacket } from '../../src/lib/evidence/wire'
import { asUser, rpc } from './db'

export interface FakeServer {
  fetch: typeof fetch
  offline: boolean
  calls: number
  errors: string[]
}

export function fakeServer(db: PGlite, userId: string): FakeServer {
  const srv: FakeServer = {
    offline: false,
    calls: 0,
    errors: [],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        return await handle(input, init)
      } catch (e) {
        if (e instanceof TypeError && e.message === 'Failed to fetch') throw e
        srv.errors.push(String(e))
        return json(500, { error: String(e) })
      }
    }) as typeof fetch,
  }
  const handle = async (input: RequestInfo | URL, init?: RequestInit) => {
      srv.calls += 1
      if (srv.offline) throw new TypeError('Failed to fetch')
      const url = String(input)
      const m = url.match(/\/api\/documents\/([0-9a-f-]+)(\/events)?$/)
      if (!m) return json(404, { error: 'not_found' })
      const [, id, events] = m
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined

      if (events && method === 'POST') {
        const parsed = eventBatch.safeParse(body)
        if (!parsed.success) return json(400, { error: 'invalid' })
        const r = await asUser(db, userId, () =>
          rpc(db, 'ingest_events', { p_document_id: id, p_events: parsed.data.events, p_sessions: parsed.data.sessions }),
        )
        return json(200, r)
      }
      if (method === 'PATCH') {
        const parsed = parseSavePacket(body)
        if (!parsed.success) {
          srv.errors.push(JSON.stringify(parsed.error.issues).slice(0, 500))
          return json(400, { error: 'invalid', issues: parsed.error.issues })
        }
        const r = await asUser(db, userId, () =>
          rpc<{ status: string }>(db, 'save_document', {
            p_document_id: id,
            p_base_version: parsed.data.base_version,
            p_content: parsed.data.content_json,
            p_mutations: parsed.data.mutations,
            p_sessions: parsed.data.sessions,
          }),
        )
        return json(r.status === 'conflict' ? 409 : 200, r)
      }
      if (method === 'GET') {
        const r = await asUser(db, userId, () =>
          db.query('select id, title, content_json, version from public.documents where id = $1', [id]),
        )
        return r.rows[0] ? json(200, r.rows[0]) : json(404, { error: 'not_found' })
      }
      return json(405, {})
  }
  return srv
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
