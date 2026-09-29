'use client'
import { useRouter } from 'next/navigation'
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n'

export function LocaleSwitch({ locale }: { locale: Locale }) {
  const router = useRouter()
  const set = (l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
  return (
    <div className="seg seg--small" role="group" aria-label="Language">
      {(['uz', 'en'] as const).map((l) => (
        <button key={l} className={locale === l ? 'is-active' : ''} aria-pressed={locale === l} onClick={() => set(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
