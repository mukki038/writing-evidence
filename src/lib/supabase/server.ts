import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

/**
 * User-scoped Supabase client (TZ §22.2): user JWT bilan, RLS va GRANT amal qiladi.
 * Service role bu loyihada ishlatilmaydi (A0).
 */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Component ichidan chaqirilganda cookie yozib bo'lmaydi — proxy yangilaydi
        }
      },
    },
  })
}

/** Joriy user id (JWT imzosi tekshiriladi). Yo'q bo'lsa null. */
export async function currentUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return null
  return data.claims.sub
}
