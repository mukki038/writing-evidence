import type { Metadata } from 'next'
import { DemoClient } from '@/components/DemoClient'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { llmConfigured } from '@/lib/feedback/llm'

export const metadata: Metadata = { title: 'Demo · Writing Evidence' }

export const dynamic = 'force-dynamic'

export default async function DemoPage() {
  const { t, locale } = await getDict()
  return <DemoClient t={t} locale={locale} canSignUp={isSupabaseConfigured()} feedbackEnabled={llmConfigured()} />
}
