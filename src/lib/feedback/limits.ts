import 'server-only'

/**
 * Oddiy xotiradagi limitlar (har bir server instance uchun alohida).
 * Asosiy himoya — Vercel Firewall rate limit va Anthropic console'dagi oylik
 * xarajat limiti; bu qatlam faqat qo'shimcha to'siq.
 */
const buckets = new Map<string, number[]>()

export function take(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) {
    buckets.set(key, arr)
    return false
  }
  arr.push(now)
  buckets.set(key, arr)
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k)
  }
  return true
}

export function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  return (xf?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim()
}

/** Boshqa saytlar bizning API'ni chaqirmasligi uchun (brauzer so'rovlari) */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  const origin = req.headers.get('origin')
  if (!origin) return !!site
  try {
    return new URL(origin).host === new URL(req.url).host || origin === process.env.NEXT_PUBLIC_SITE_URL
  } catch {
    return false
  }
}

/** Kichik LRU kesh: bir xil matn qayta tahlil qilinmaydi */
export class Lru<V> {
  private m = new Map<string, V>()
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k)
    if (v !== undefined) {
      this.m.delete(k)
      this.m.set(k, v)
    }
    return v
  }
  set(k: string, v: V) {
    this.m.delete(k)
    this.m.set(k, v)
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!)
  }
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
