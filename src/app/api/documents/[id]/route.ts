import { json, readJson, rpcError, validId, withUser } from '@/lib/api'
import { MAX_PACKET_BYTES } from '@/lib/evidence/constants'
import { parseSavePacket, titleUpdate, type SaveResult } from '@/lib/evidence/wire'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!validId(id)) return json(404, { error: 'not_found' })
  return withUser(async (supabase) => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, content_json, version, doc_size, word_count, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    if (error) return rpcError(error)
    if (!data) return json(404, { error: 'not_found' })
    return json(200, data)
  })
}

/**
 * Autosave (TZ §10.9): {base_version, content_json, mutations[], sessions[]}
 * → save_document tranzaksiyasi; versiya mos kelmasa 409.
 * Faqat {title} yuborilsa — nom o'zgartiriladi.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!validId(id)) return json(404, { error: 'not_found' })
  return withUser(async (supabase) => {
    const r = await readJson(req, MAX_PACKET_BYTES)
    if (!r.ok) return r.res
    const body = r.body as Record<string, unknown> | null

    if (body && typeof body === 'object' && !('mutations' in body)) {
      const t = titleUpdate.safeParse(body)
      if (!t.success) return json(400, { error: 'invalid' })
      const { data, error } = await supabase.from('documents').update({ title: t.data.title }).eq('id', id).select('id, title')
      if (error) return rpcError(error)
      if (!data?.length) return json(404, { error: 'not_found' })
      return json(200, data[0])
    }

    const parsed = parseSavePacket(body)
    if (!parsed.success) return json(400, { error: 'invalid', issues: parsed.error.issues.slice(0, 5) })
    const p = parsed.data
    const { data, error } = await supabase.rpc('save_document', {
      p_document_id: id,
      p_base_version: p.base_version,
      p_content: p.content_json,
      p_mutations: p.mutations,
      p_sessions: p.sessions,
    })
    if (error) return rpcError(error)
    const result = data as SaveResult
    return json(result.status === 'conflict' ? 409 : 200, result)
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!validId(id)) return json(404, { error: 'not_found' })
  return withUser(async (supabase) => {
    const { data, error } = await supabase.from('documents').delete().eq('id', id).select('id')
    if (error) return rpcError(error)
    if (!data?.length) return json(404, { error: 'not_found' })
    return json(200, { deleted: true })
  })
}
