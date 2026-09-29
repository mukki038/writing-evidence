import 'server-only'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, dictionaries, isLocale, type Dict, type Locale } from './i18n'

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(v) ? v : 'uz'
}

export async function getDict(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale()
  return { locale, t: dictionaries[locale] }
}
