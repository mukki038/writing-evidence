import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'
import { getDict } from '@/lib/i18n-server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createClient, currentUserId } from '@/lib/supabase/server'
import { LocaleSwitch } from '@/components/LocaleSwitch'

export const metadata: Metadata = {
  title: 'Writing Evidence',
  description: 'Write your academic work. Keep evidence of how it was created.',
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#161614' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getDict()
  const configured = isSupabaseConfigured()
  let signedIn = false
  if (configured) {
    try {
      signedIn = !!(await currentUserId(await createClient()))
    } catch {
      signedIn = false
    }
  }

  return (
    <html lang={locale}>
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>
              ¶
            </span>
            {t.brand}
          </Link>
          <nav className="site-nav">
            <Link href="/demo">{t.nav.demo}</Link>
            {signedIn ? (
              <>
                <Link href="/dashboard">{t.nav.dashboard}</Link>
                <form action="/auth/signout" method="post">
                  <button className="linklike" type="submit">
                    {t.nav.logout}
                  </button>
                </form>
              </>
            ) : !configured ? null : (
              <>
                <Link href="/login">{t.nav.login}</Link>
                <Link href="/signup" className="nav-cta">
                  {t.nav.signup}
                </Link>
              </>
            )}
            <LocaleSwitch locale={locale} />
          </nav>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <span>{t.footer}</span>
          <Link href="/privacy">{t.nav.privacy}</Link>
        </footer>
      </body>
    </html>
  )
}
