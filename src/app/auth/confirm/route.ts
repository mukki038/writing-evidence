import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

/** Email tasdiqlash va parol tiklash havolalari (token_hash yoki PKCE code) */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const nextParam = url.searchParams.get('next') ?? '/dashboard'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'
  const fail = NextResponse.redirect(new URL('/login?error=link', request.url))
  if (!isSupabaseConfigured()) return fail

  const supabase = await createClient()
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const code = url.searchParams.get('code')

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/update-password' : next, request.url))
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, request.url))
  }
  return fail
}
