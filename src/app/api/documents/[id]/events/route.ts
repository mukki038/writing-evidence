import { json, readJson, rpcError, validId, withUser } from '@/lib/api'
import { eventBatch } from '@/lib/evidence/wire'

export const dynamic = 'force-dynamic'

/** Session va telemetriya event'lari (≤ 200 / 256 KB, idempotent). sendBeacon ham shu yerga. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!validId(id)) return json(404, { error: 'not_found' })
  return withUser(async (supabase) => {
    const r = await readJson(req, 256 * 1024)
    if (!r.ok) return r.res
    const parsed = eventBatch.safeParse(r.body)
    if (!parsed.success) return json(400, { error: 'invalid' })
    const { data, error } = await supabase.rpc('ingest_events', {
      p_document_id: id,
      p_events: parsed.data.events,
      p_sessions: parsed.data.sessions,
    })
    if (error) return rpcError(error)
    return json(200, data)
  })
}
