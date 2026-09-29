import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isSupabaseConfigured } from './supabase/config'
import { createClient, currentUserId } from './supabase/server'

export type Supa = Awaited<ReturnType<typeof createClient>>

export function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** Autentifikatsiya qilingan route: user-scoped client (RLS + GRANT amal qiladi). */
export async function withUser(fn: (supabase: Supa, userId: string) => Promise<NextResponse>): Promise<NextResponse> {
  if (!isSupabaseConfigured()) return json(503, { error: 'not_configured' })
  const supabase = await createClient()
  const userId = await currentUserId(supabase)
  if (!userId) return json(401, { error: 'unauthorized' })
  try {
    return await fn(supabase, userId)
  } catch (e) {
    // Log'larda hujjat matni yo'q (TZ §20): faqat xato turi
    console.error('route_error', e instanceof Error ? e.name : 'unknown')
    return json(500, { error: 'internal' })
  }
}

const uuid = z.uuid()
export function validId(id: string): boolean {
  return uuid.safeParse(id).success
}

/** So'rov tanasini hajm chegarasi bilan o'qish (TZ §24) */
export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > maxBytes) return { ok: false, res: json(413, { error: 'payload_too_large' }) }
  const text = await req.text()
  if (text.length > maxBytes) return { ok: false, res: json(413, { error: 'payload_too_large' }) }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, res: json(400, { error: 'invalid_json' }) }
  }
}

/** Postgres xato kodlari → HTTP (funksiyalardagi errcode'lar) */
export function rpcError(err: { code?: string; message?: string }): NextResponse {
  switch (err.code) {
    case '42501':
      return json(err.message?.includes('permission') ? 403 : 401, { error: 'forbidden' })
    case 'P0002':
      return json(404, { error: 'not_found' })
    case '22023':
      return json(400, { error: 'invalid', detail: err.message?.slice(0, 120) })
    case '54000':
      return json(413, { error: err.message?.includes('document_too_large') ? 'document_too_large' : 'payload_too_large' })
    default:
      console.error('rpc_error', err.code)
      return json(500, { error: 'internal' })
  }
}
