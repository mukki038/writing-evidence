'use client'
import { useEffect, useState } from 'react'

const FALLBACK_TZ = 'Asia/Seoul'

function fmt(iso: string, tz: string, locale: string, withDate: boolean) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'uz' ? 'en-GB' : 'en-US', {
    timeZone: tz,
    ...(withDate ? { year: 'numeric', month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Vaqt: birinchi render deterministik (Asia/Seoul — asosiy bozor), mount'dan
 * keyin foydalanuvchi vaqt zonasida qayta formatlanadi (hydration mos keladi).
 */
export function Time({ iso, locale = 'uz', date = true }: { iso: string; locale?: string; date?: boolean }) {
  const [tz, setTz] = useState(FALLBACK_TZ)
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ)
    } catch {
      /* default */
    }
  }, [])
  return <time dateTime={iso}>{fmt(iso, tz, locale, date)}</time>
}
