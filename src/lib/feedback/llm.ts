import 'server-only'

/**
 * Anthropic Messages API — tool majburiy (tool_choice), shuning uchun javob
 * har doim tuzilmali JSON. Kalit faqat serverda (ANTHROPIC_API_KEY).
 */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

export class LlmError extends Error {
  constructor(
    public code: 'not_configured' | 'upstream' | 'timeout' | 'bad_output',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export function llmConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').length > 20
}

interface Tool {
  name: string
  description: string
  input_schema: unknown
}

export async function callTool<T>(opts: {
  system: string
  user: string
  tool: Tool
  maxTokens: number
  temperature: number
  timeoutMs?: number
}): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.length <= 20) throw new LlmError('not_configured')

  let res: Response
  try {
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
    res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        tools: [opts.tool],
        tool_choice: { type: 'tool', name: opts.tool.name },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    })
  } catch (e) {
    throw new LlmError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'upstream')
  }

  if (!res.ok) {
    // Log'da matn yo'q — faqat status (TZ §20)
    console.error('llm_http_error', res.status)
    throw new LlmError('upstream', `http_${res.status}`)
  }
  const body = (await res.json().catch(() => null)) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>
    stop_reason?: string
  } | null
  const block = body?.content?.find((c) => c.type === 'tool_use' && c.name === opts.tool.name)
  if (!block || typeof block.input !== 'object' || block.input === null) {
    console.error('llm_bad_output', body?.stop_reason)
    throw new LlmError('bad_output')
  }
  return block.input as T
}
