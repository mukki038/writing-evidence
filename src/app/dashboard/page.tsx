import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createClient, currentUserId } from '@/lib/supabase/server'
import { DeleteDocButton, NewDocForm } from '@/components/DashboardActions'
import { Time } from '@/components/Time'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  if (!isSupabaseConfigured()) redirect('/login')
  const { t, locale } = await getDict()
  const supabase = await createClient()
  if (!(await currentUserId(supabase))) redirect('/login?next=/dashboard')

  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, word_count, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200)

  return (
    <div className="dashboard">
      <div className="dash-head">
        <h1>{t.dash.title}</h1>
        <NewDocForm t={t} />
      </div>
      {!docs?.length ? (
        <p className="muted card pad">{t.dash.empty}</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="card doc-item">
              <Link href={`/documents/${d.id}`} className="doc-item-main">
                <strong>{d.title || t.editor.untitled}</strong>
                <span className="muted small">
                  {d.word_count.toLocaleString()} {t.dash.words} · {t.dash.updated}: <Time iso={d.updated_at} locale={locale} />
                </span>
              </Link>
              <div className="doc-item-actions">
                <Link href={`/documents/${d.id}/timeline`} className="btn btn--small btn--ghost">
                  {t.dash.timeline}
                </Link>
                <DeleteDocButton id={d.id} t={t} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
