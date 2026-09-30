import 'server-only'
import { NextResponse } from 'next/server'
import { callTool, LlmError } from './llm'
import { clientIp, Lru, sameOrigin, sha256, take } from './limits'
import { analyzeSystem, analyzeTool, analyzeUser, PROMPT_VERSION, variantsSystem, variantsTool, variantsUser } from './prompts'
import {
  analyzeRequest,
  MAX_WORDS,
  MIN_WORDS,
  variantsRequest,
  wordCount,
  type AnalyzeResponse,
  type FeedbackError,
  type VariantsResponse,
} from './types'
import { cleanVariants, locateFlags } from './validate'

const ANALYZE_PER_IP = { limit: 8, windowMs: 10 * 60_000 }
const VARIANTS_PER_IP = { limit: 40, windowMs: 10 * 60_000 }
const ANALYZE_GLOBAL_DAY = { limit: 300, windowMs: 24 * 3600_000 }

const analyzeCache = new Lru<AnalyzeResponse>(200)
const variantsCache = new Lru<VariantsResponse>(500)

function err(status: number, error: FeedbackError): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
}

function ok(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}

async function readBody(req: Request, max: number): Promise<unknown | null> {
  const text = await req.text()
  if (text.length > max) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function llmFailure(e: unknown): NextResponse {
  if (e instanceof LlmError && e.code === 'not_configured') return err(503, 'not_configured')
  return err(502, 'upstream')
}

export async function handleAnalyze(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return err(403, 'forbidden')
  const parsed = analyzeRequest.safeParse(await readBody(req, 40_000))
  if (!parsed.success) return err(400, 'invalid')
  const { text, locale } = parsed.data
  const words = wordCount(text)
  if (words < MIN_WORDS) return err(400, 'too_short')
  if (words > MAX_WORDS) return err(400, 'too_long')

  const key = await sha256(`${PROMPT_VERSION}|${locale}|${text}`)
  const cached = analyzeCache.get(key)
  if (cached) return ok(cached)

  if (!take(`a:${clientIp(req)}`, ANALYZE_PER_IP.limit, ANALYZE_PER_IP.windowMs)) return err(429, 'rate_limited')
  if (!take('a:global', ANALYZE_GLOBAL_DAY.limit, ANALYZE_GLOBAL_DAY.windowMs)) return err(429, 'rate_limited')

  try {
    const out = await callTool<{ flags?: unknown; summary?: unknown }>({
      system: analyzeSystem(locale),
      user: analyzeUser(text),
      tool: analyzeTool,
      maxTokens: 2500,
      temperature: 0,
    })
    const result: AnalyzeResponse = {
      flags: locateFlags(text, out.flags),
      summary: typeof out.summary === 'string' ? out.summary.trim().slice(0, 500) : '',
    }
    analyzeCache.set(key, result)
    return ok(result)
  } catch (e) {
    return llmFailure(e)
  }
}

export async function handleVariants(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return err(403, 'forbidden')
  const parsed = variantsRequest.safeParse(await readBody(req, 12_000))
  if (!parsed.success) return err(400, 'invalid')
  const p = parsed.data

  const key = await sha256(`${PROMPT_VERSION}|${JSON.stringify(p)}`)
  const cached = variantsCache.get(key)
  if (cached) return ok(cached)

  if (!take(`v:${clientIp(req)}`, VARIANTS_PER_IP.limit, VARIANTS_PER_IP.windowMs)) return err(429, 'rate_limited')

  try {
    const out = await callTool<{ variants?: unknown }>({
      system: variantsSystem(),
      user: variantsUser(p),
      tool: variantsTool,
      maxTokens: 900,
      temperature: 0.4,
    })
    const variants = cleanVariants(p.excerpt, out.variants)
    if (!variants.length) return err(502, 'upstream')
    const result: VariantsResponse = { variants }
    variantsCache.set(key, result)
    return ok(result)
  } catch (e) {
    return llmFailure(e)
  }
}
