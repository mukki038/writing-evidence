import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { history } from '@tiptap/pm/history'
import { editorSchema } from '../src/lib/editor/extensions'
import { createRecorder } from '../src/lib/evidence/recorder'
import { SOURCE_META } from '../src/lib/evidence/constants'
import { composition } from '../src/lib/evidence/composition'
import {
  buildTextIndex,
  feedbackKey,
  feedbackPlugin,
  getFeedbackState,
  placeFlags,
  rangeToPos,
} from '../src/lib/editor/feedback-plugin'
import { cleanVariants, findExcerpt, locateFlags } from '../src/lib/feedback/validate'
import type { PMJSON } from '../src/lib/evidence/text'

const DOC: PMJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Feedback timing' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Students revise more when feedback is quick. It is very very important.' }] },
    { type: 'paragraph' },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first point 😀 here' }] }] },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'second ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quoted “claim” here.' }] }] },
  ],
}

describe('validate', () => {
  const text = 'Students revise more when feedback is quick.\nIt’s very very important — really.'

  it('excerpt aniq va yumshoq (qo‘shtirnoq, tire, bo‘shliq) topiladi', () => {
    expect(findExcerpt(text, 'feedback is quick')).toEqual([26, 43])
    const loose = findExcerpt(text, "It's very  very important - really")!
    expect(text.slice(loose[0], loose[1])).toBe('It’s very very important — really')
    expect(findExcerpt(text, 'not in the text')).toBeNull()
  })

  it('locateFlags: yo‘q parcha, paragraflararo, noto‘g‘ri kategoriya va ustma-ust flag tashlanadi', () => {
    const flags = locateFlags(text, [
      { excerpt: 'very very important', category: 'repetition', reason: 'Repeated word.' },
      { excerpt: 'hallucinated sentence', category: 'clarity', reason: 'x' },
      { excerpt: 'quick.\nIt’s', category: 'clarity', reason: 'x' },
      { excerpt: 'Students revise', category: 'ai_likeness', reason: 'x' },
      { excerpt: 'very important', category: 'clarity', reason: 'overlap' },
      { excerpt: 'Students revise more', category: 'grammar', reason: 'x' },
    ])
    expect(flags.map((f) => [f.excerpt, f.category])).toEqual([
      ['Students revise more', 'grammar'],
      ['very very important', 'repetition'],
    ])
    for (const f of flags) expect(text.slice(f.start, f.end)).toBe(f.excerpt)
  })

  it('bir xil parcha ikki marta uchrasa — ikkinchisi ham belgilanadi', () => {
    const t = 'data shows that. data shows that.'
    const flags = locateFlags(t, [
      { excerpt: 'data shows that', category: 'repetition', reason: 'a' },
      { excerpt: 'data shows that', category: 'repetition', reason: 'b' },
    ])
    expect(flags.map((f) => f.start)).toEqual([0, 17])
  })

  it('cleanVariants: bo‘sh, bir xil, asl bilan teng, juda uzun olib tashlanadi; qo‘shtirnoq yechiladi', () => {
    const v = cleanVariants('It is very very important.', [
      '"It is extremely important."',
      'It is extremely important.',
      'it is very very important.',
      '',
      'x'.repeat(500),
      'This matters greatly.',
      'It is crucial.',
      'Fourth one.',
    ])
    expect(v).toEqual(['It is extremely important.', 'This matters greatly.', 'It is crucial.'])
  })
})

describe('matn indeksi', () => {
  const doc = editorSchema.nodeFromJSON(DOC)

  it('buildTextIndex matni doc.textBetween(0, size, "\\n") bilan bir xil', () => {
    expect(buildTextIndex(doc).text).toBe(doc.textBetween(0, doc.content.size, '\n'))
  })

  it('har qanday bitta blok ichidagi oraliq to‘g‘ri pozitsiyaga o‘tadi', () => {
    const idx = buildTextIndex(doc)
    for (const b of idx.blocks) {
      for (let s = b.textStart; s <= b.textStart + b.length; s++) {
        for (let e = s; e <= b.textStart + b.length; e++) {
          const pos = rangeToPos(idx, s, e)!
          expect(doc.textBetween(pos[0], pos[1], '\n')).toBe(idx.text.slice(s, e))
        }
      }
    }
    // bloklararo oraliq rad etiladi
    expect(rangeToPos(idx, idx.blocks[0].textStart, idx.blocks[1].textStart + 3)).toBeNull()
  })
})

function makeState() {
  const recorder = createRecorder({
    signals: {
      lastUserInputAt: Date.now(),
      lastReplacementAt: Number.NEGATIVE_INFINITY,
      lastPasteAt: Number.NEGATIVE_INFINITY,
      lastDropAt: Number.NEGATIVE_INFINITY,
      composing: true, // "user yozmoqda" — manba typing bo'lishi uchun
    },
  })
  let state = EditorState.create({
    schema: editorSchema,
    doc: editorSchema.nodeFromJSON(DOC),
    plugins: [history(), recorder.plugin, feedbackPlugin()],
  })
  const text = buildTextIndex(state.doc).text
  const flags = locateFlags(text, [
    { excerpt: 'very very important', category: 'repetition', reason: 'Repeated.' },
    { excerpt: 'feedback is quick', category: 'clarity', reason: 'Vague.' },
  ])
  const placed = placeFlags(state.doc, flags)
  state = state.apply(state.tr.setMeta(feedbackKey, { type: 'set', flags: placed }))
  return {
    get state() {
      return state
    },
    apply(tr: ReturnType<EditorState['tr']['setMeta']>) {
      state = state.apply(tr)
    },
    recorder,
  }
}

describe('feedback plugin', () => {
  it('flag’lar joyiga qo‘yiladi va decoration hosil qiladi', () => {
    const s = makeState()
    const fs = getFeedbackState(s.state)
    expect(fs.flags.map((f) => f.excerpt)).toEqual(['feedback is quick', 'very very important'])
    for (const f of fs.flags) expect(s.state.doc.textBetween(f.from, f.to)).toBe(f.excerpt)
  })

  it('flag’dan oldin matn qo‘shilsa pozitsiya siljiydi, flag saqlanadi', () => {
    const s = makeState()
    s.apply(s.state.tr.insertText('Many ', 1 + 'Feedback timing'.length + 3))
    const fs = getFeedbackState(s.state)
    expect(fs.flags).toHaveLength(2)
    for (const f of fs.flags) expect(s.state.doc.textBetween(f.from, f.to)).toBe(f.excerpt)
  })

  it('talaba parchani o‘zi tahrirlasa → “self” deb hal qilinadi', () => {
    const s = makeState()
    const f = getFeedbackState(s.state).flags.find((x) => x.category === 'repetition')!
    s.apply(s.state.tr.delete(f.from, f.from + 5)) // "very " o'chirildi
    const fs = getFeedbackState(s.state)
    expect(fs.flags.map((x) => x.category)).toEqual(['clarity'])
    expect(fs.resolved).toEqual([{ id: f.id, category: 'repetition', by: 'self' }])
  })

  it('AI varianti qo‘llansa → “ai” deb hal qilinadi va matn origin: ai oladi', () => {
    const s = makeState()
    const f = getFeedbackState(s.state).flags.find((x) => x.category === 'repetition')!
    s.apply(s.state.tr.insertText('extremely important', f.from, f.to).setMeta(SOURCE_META, 'ai'))
    const fs = getFeedbackState(s.state)
    expect(fs.resolved).toEqual([{ id: f.id, category: 'repetition', by: 'ai' }])
    expect(composition(s.state.doc).ai).toBe('extremely important'.length)
    const m = s.recorder.drain().at(-1)!
    expect(m).toMatchObject({ source: 'ai', inserted_chars: 19, deleted_chars: 19 })
  })

  it('dismiss va select', () => {
    const s = makeState()
    const [a, b] = getFeedbackState(s.state).flags
    s.apply(s.state.tr.setMeta(feedbackKey, { type: 'select', id: b.id }))
    expect(getFeedbackState(s.state).selected).toBe(b.id)
    s.apply(s.state.tr.setMeta(feedbackKey, { type: 'dismiss', id: b.id }))
    expect(getFeedbackState(s.state).flags.map((x) => x.id)).toEqual([a.id])
    expect(getFeedbackState(s.state).selected).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Server handler — Anthropic javobi mock qilinadi
// ---------------------------------------------------------------------------
describe('server: /api/feedback', () => {
  const draft =
    'Students revise more when feedback is quick. It is very very important for students because feedback helps students improve their writing and students like it.'
  let calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []

  beforeEach(() => {
    vi.resetModules()
    calls = []
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-000000000000'
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push({ url, body, headers: init.headers as Record<string, string> })
      const input =
        body.tools[0].name === 'report_feedback'
          ? {
              summary: 'Clear main idea.',
              flags: [
                { excerpt: 'very very important', category: 'repetition', reason: 'Repeated “very”.' },
                { excerpt: 'this text does not exist', category: 'clarity', reason: 'x' },
                { excerpt: 'students like it', category: 'academic_style', reason: 'Informal.' },
              ],
            }
          : { variants: ['extremely important', 'crucial', 'very very important'] }
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools[0].name, input }], stop_reason: 'tool_use' }), {
        status: 200,
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ANTHROPIC_API_KEY
  })

  const req = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`https://writing-evidence.vercel.app${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://writing-evidence.vercel.app',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-for': '1.2.3.4',
        ...headers,
      },
      body: JSON.stringify(body),
    })

  it('tahlil: tool majburiy, soxta excerpt tashlanadi, offsetlar to‘g‘ri, kesh ishlaydi', async () => {
    const { handleAnalyze } = await import('../src/lib/feedback/handlers')
    const res = await handleAnalyze(req('/api/feedback', { text: draft, locale: 'uz' }))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { flags: Array<{ excerpt: string; start: number; end: number }>; summary: string }
    expect(data.flags.map((f) => f.excerpt)).toEqual(['very very important', 'students like it'])
    for (const f of data.flags) expect(draft.slice(f.start, f.end)).toBe(f.excerpt)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test-key-000000000000')
    expect(calls[0].body.tool_choice).toEqual({ type: 'tool', name: 'report_feedback' })
    expect(String(calls[0].body.system)).toContain('Uzbek')
    expect(String(calls[0].body.system)).toContain('Never judge or mention whether the text was written by AI')

    // ikkinchi marta — keshdan, API chaqirilmaydi
    const again = await handleAnalyze(req('/api/feedback', { text: draft, locale: 'uz' }))
    expect(again.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('variantlar: asl bilan bir xili tashlanadi', async () => {
    const { handleVariants } = await import('../src/lib/feedback/handlers')
    const res = await handleVariants(
      req('/api/feedback/variants', {
        excerpt: 'very very important',
        category: 'repetition',
        reason: 'Repeated.',
        before: 'It is ',
        after: ' for students',
        locale: 'en',
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ variants: ['extremely important', 'crucial'] })
  })

  it('himoya: boshqa sayt, qisqa matn, noto‘g‘ri format, kalitsiz, IP limit', async () => {
    const { handleAnalyze } = await import('../src/lib/feedback/handlers')
    expect((await handleAnalyze(req('/api/feedback', { text: draft, locale: 'uz' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect((await handleAnalyze(req('/api/feedback', { text: 'too short text', locale: 'uz' }))).status).toBe(400)
    expect((await handleAnalyze(req('/api/feedback', { text: draft, locale: 'ru' }))).status).toBe(400)
    expect((await handleAnalyze(req('/api/feedback', { text: draft, locale: 'uz', extra: 1 }))).status).toBe(400)

    // limit: bir IP dan 8 ta turli matn, 9-si rad etiladi
    const statuses: number[] = []
    for (let i = 0; i < 9; i++) {
      statuses.push((await handleAnalyze(req('/api/feedback', { text: `${draft} Variant ${i}.`, locale: 'en' }, { 'x-forwarded-for': '9.9.9.9' }))).status)
    }
    expect(statuses.slice(0, 8).every((s) => s === 200)).toBe(true)
    expect(statuses[8]).toBe(429)

    delete process.env.ANTHROPIC_API_KEY
    vi.resetModules()
    const fresh = await import('../src/lib/feedback/handlers')
    const r = await fresh.handleAnalyze(req('/api/feedback', { text: draft + ' new', locale: 'en' }))
    expect(r.status).toBe(503)
  })

  it('Anthropic xato qaytarsa — 502, matn log’ga yozilmaydi', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')))
    vi.stubGlobal('fetch', async () => new Response('{"error":{}}', { status: 529 }))
    const { handleAnalyze } = await import('../src/lib/feedback/handlers')
    const res = await handleAnalyze(req('/api/feedback', { text: draft + ' x', locale: 'en' }))
    expect(res.status).toBe(502)
    expect(logs.join(' ')).not.toContain('Students')
  })
})
