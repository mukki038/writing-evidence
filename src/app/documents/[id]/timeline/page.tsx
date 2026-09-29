import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { TimelineView } from '@/components/TimelineView'
import { validId } from '@/lib/api'
import { compositionFromJSON } from '@/lib/evidence/composition'
import type { PMJSON } from '@/lib/evidence/text'
import type { TimelineData } from '@/lib/evidence/timeline'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createClient, currentUserId } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) notFound()
  if (!isSupabaseConfigured()) redirect('/login')
  const supabase = await createClient()
  if (!(await currentUserId(supabase))) redirect(`/login?next=/documents/${id}/timeline`)
  const { t, locale } = await getDict()

  const [{ data: timeline }, { data: doc }] = await Promise.all([
    supabase.rpc('document_timeline', { p_document_id: id }),
    supabase.from('documents').select('content_json').eq('id', id).maybeSingle(),
  ])
  if (!timeline || !doc) notFound()
  const data = timeline as TimelineData

  return (
    <div className="timeline-page">
      <Link href={`/documents/${id}`} className="muted small">
        {t.tl.back}
      </Link>
      <h1>{t.tl.title}</h1>
      <p className="doc-name">{data.document.title || t.editor.untitled}</p>
      <p className="banner banner--info">{t.tl.disclaimer}</p>
      <TimelineView data={data} composition={compositionFromJSON(doc.content_json as PMJSON)} t={t} locale={locale} />
    </div>
  )
}
