import { z } from 'zod'
import { json, readJson, rpcError, withUser } from '@/lib/api'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withUser(async (supabase) => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, word_count, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) return rpcError(error)
    return json(200, { documents: data })
  })
}

const createBody = z.strictObject({ title: z.string().trim().max(200).default('') })

export async function POST(req: Request) {
  return withUser(async (supabase) => {
    const r = await readJson(req, 4096)
    if (!r.ok) return r.res
    const parsed = createBody.safeParse(r.body ?? {})
    if (!parsed.success) return json(400, { error: 'invalid' })
    const { data, error } = await supabase.rpc('create_document', { p_title: parsed.data.title })
    if (error) return rpcError(error)
    return json(201, data)
  })
}
