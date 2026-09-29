import { json, rpcError, validId, withUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!validId(id)) return json(404, { error: 'not_found' })
  return withUser(async (supabase) => {
    const { data, error } = await supabase.rpc('document_timeline', { p_document_id: id })
    if (error) return rpcError(error)
    if (!data) return json(404, { error: 'not_found' })
    return json(200, data)
  })
}
