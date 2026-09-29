import { Suspense } from 'react'
import { AuthForm } from '@/components/AuthForm'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export default async function Page() {
  const { t } = await getDict()
  return (
    <div className="narrow">
      <Suspense>
        <AuthForm mode="login" t={t} configured={isSupabaseConfigured()} />
      </Suspense>
    </div>
  )
}
