import { notFound, redirect } from 'next/navigation'
import { DocumentEditor } from '@/components/DocumentEditor'
import { validId } from '@/lib/api'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createClient, currentUserId } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) notFound()
  if (!isSupabaseConfigured()) redirect('/login')
  const supabase = await createClient()
  if (!(await currentUserId(supabase))) redirect(`/login?next=/documents/${id}`)
  const { t, locale } = await getDict()
  return <DocumentEditor id={id} t={t} locale={locale} />
}
