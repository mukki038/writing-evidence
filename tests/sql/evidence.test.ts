import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser, rpc } from './db'
import { fakeServer } from './fake-server'
import { makeEditor } from '../editor-harness'
import { EvidenceSync } from '../../src/lib/sync/controller'
import { memoryStore } from '../../src/lib/sync/store'
import { docSize, contentText, wellFormed, type PMJSON } from '../../src/lib/evidence/text'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let db: PGlite

beforeAll(async () => {
  db = await createDb()
  await createUser(db, A)
  await createUser(db, B)
})

async function newDoc(user = A): Promise<string> {
  const r = await asUser(db, user, () => rpc<{ id: string }>(db, 'create_document', { p_title: 'T' }))
  return r.id
}

function uuid() {
  return crypto.randomUUID()
}

function mutation(sessionId: string, seq: number, over: Record<string, unknown> = {}) {
  return {
    client_mutation_id: uuid(),
    session_id: sessionId,
    seq,
    from: 1,
    to: 1,
    deleted_size: 0,
    inserted_size: 5,
    deleted_chars: 0,
    inserted_chars: 5,
    source: 'typing',
    client_ts: new Date().toISOString(),
    ...over,
  }
}

function docWith(text: string): PMJSON {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }] }
}

async function save(docId: string, base: number, content: PMJSON, mutations: unknown[], sessions: unknown[], user = A) {
  return asUser(db, user, () =>
    rpc<Record<string, unknown>>(db, 'save_document', {
      p_document_id: docId,
      p_base_version: base,
      p_content: content,
      p_mutations: mutations,
      p_sessions: sessions,
    }),
  )
}

async function events(docId: string, type?: string) {
  const r = await db.query<{ type: string; payload: Record<string, unknown> }>(
    `select type, payload from public.events where document_id = $1 ${type ? 'and type = $2' : ''} order by id`,
    type ? [docId, type] : [docId],
  )
  return r.rows
}

describe('server o‘lchovi = ProseMirror o‘lchovi', () => {
  it('doc_size (UTF-16, emoji) va content_text mos keladi', async () => {
    const content: PMJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title 😀' }] },
        { type: 'paragraph' },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two ', marks: [{ type: 'bold' }] }] },
                { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote 𝒜' }] }] },
              ],
            },
          ],
        },
      ],
    }
    const r = await db.query<{ size: number; txt: string }>(`select (private.pm_doc($1::jsonb)).*`, [JSON.stringify(content)])
    expect(r.rows[0].size).toBe(docSize(content))
    expect(r.rows[0].txt.normalize('NFC')).toBe(contentText(content))
  })

  it('ruxsat etilmagan tugun/mark rad etiladi', async () => {
    const bad = { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }
    await expect(db.query(`select private.pm_doc($1::jsonb)`, [JSON.stringify(bad)])).rejects.toThrow(/invalid_content/)
    const badMark = docWith('x')
    ;(badMark.content![0].content![0] as PMJSON).marks = [{ type: 'link', attrs: { href: 'x' } }]
    await expect(db.query(`select private.pm_doc($1::jsonb)`, [JSON.stringify(badMark)])).rejects.toThrow(/invalid_content/)
  })
})

describe('save_document', () => {
  it('oddiy saqlash: versiya +1, derived event, so‘z soni serverda', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const r = await save(id, 0, docWith('Hello'), [mutation(s.id, 1)], [s])
    expect(r).toMatchObject({ status: 'ok', version: 1, word_count: 1, unrecorded_change: false })
  })

  it('A5: bitta paket 3 marta yuborilsa — mutation’lar bir marta', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const muts = [mutation(s.id, 1), mutation(s.id, 2, { from: 6, to: 6, inserted_size: 6, inserted_chars: 6 })]
    const content = docWith('Hello world')
    const r1 = await save(id, 0, content, muts, [s])
    const r2 = await save(id, 0, content, muts, [s])
    const r3 = await save(id, 0, content, muts, [s])
    expect(r1.status).toBe('ok')
    expect(r2).toMatchObject({ status: 'duplicate', version: 1 })
    expect(r3).toMatchObject({ status: 'duplicate', version: 1 })
    const c = await db.query<{ n: number }>('select count(*)::int as n from public.mutations where document_id = $1', [id])
    expect(c.rows[0].n).toBe(2)
  })

  it('409: base_version mos kelmasa — hech narsa yozilmaydi', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    await save(id, 0, docWith('Hello'), [mutation(s.id, 1)], [s])
    const r = await save(id, 0, docWith('Other'), [mutation(s.id, 2)], [s])
    expect(r).toMatchObject({ status: 'conflict', version: 1 })
    const c = await db.query<{ n: number }>('select count(*)::int as n from public.mutations where document_id = $1', [id])
    expect(c.rows[0].n).toBe(1)
  })

  it('A10: mutation’siz qo‘shilgan 1000 belgi → unrecorded_change', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    // mutation'lar 5 belgi deydi, content'da esa 1005 belgi
    const r = await save(id, 0, docWith('Hello' + 'x'.repeat(1000)), [mutation(s.id, 1)], [s])
    expect(r).toMatchObject({ status: 'ok', unrecorded_change: true })
    const ev = await events(id, 'unrecorded_change')
    expect(ev[0].payload).toMatchObject({ delta_size: 1000, from_version: 0, to_version: 1 })
  })

  it('A10: client doc_size’ni soxtalashtira olmaydi — server o‘zi hisoblaydi', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const content = { ...docWith('Hello'), doc_size: 9999, content_text: 'x' } as unknown as PMJSON
    const r = await save(id, 0, content, [mutation(s.id, 1)], [s])
    expect(r).toMatchObject({ doc_size: 7, word_count: 1 })
    const d = await db.query<{ content_text: string }>('select content_text from public.documents where id = $1', [id])
    expect(d.rows[0].content_text).toBe('Hello')
  })

  it('tashqi kiritish ≥ 40 belgi → text_inserted + darhol snapshot; moved → text_moved', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const text = 'p'.repeat(60)
    const r = await save(id, 0, docWith(text), [mutation(s.id, 1, { inserted_size: 60, inserted_chars: 60, source: 'paste' })], [s])
    expect(r).toMatchObject({ status: 'ok', snapshot: true })
    const r2 = await save(id, 1, docWith(text + 'mmmmm'), [mutation(s.id, 2, { from: 61, to: 61, source: 'moved' })], [s])
    expect(r2.status).toBe('ok')
    const types = (await events(id)).map((e) => e.type)
    expect(types).toEqual(['text_inserted', 'text_moved'])
  })

  it('yaroqsiz paket rad etiladi (noma’lum source, boshqa hujjat session’i)', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    await expect(save(id, 0, docWith('Hello'), [mutation(s.id, 1, { source: 'teleport' })], [s])).rejects.toThrow(/source/)
    const other = await newDoc()
    const s2 = { id: uuid(), started_at: new Date().toISOString() }
    await save(other, 0, docWith('Hello'), [mutation(s2.id, 1)], [s2])
    await expect(save(id, 0, docWith('Hello'), [mutation(s2.id, 1)], [s2])).rejects.toThrow(/session/)
  })

  it('30 000 so‘zdan oshsa rad etiladi', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const big = 'w '.repeat(30001).trim()
    await expect(
      save(id, 0, docWith(big), [mutation(s.id, 1, { inserted_size: big.length, inserted_chars: big.length })], [s]),
    ).rejects.toThrow(/document_too_large/)
  })
})

describe('vaqt algoritmi (TZ §11)', () => {
  it('offline yozuv: client_ts saqlanadi, offline = true', async () => {
    const id = await newDoc()
    const start = new Date(Date.now() - 20 * 60_000)
    const s = { id: uuid(), started_at: start.toISOString() }
    const ts = new Date(Date.now() - 10 * 60_000).toISOString()
    await save(id, 0, docWith('Hello'), [mutation(s.id, 1, { client_ts: ts })], [s])
    const r = await db.query<{ offline: boolean; clock_adjusted: boolean; effective_ts: Date }>(
      'select offline, clock_adjusted, effective_ts from public.mutations where document_id = $1',
      [id],
    )
    expect(r.rows[0]).toMatchObject({ offline: true, clock_adjusted: false })
    expect(r.rows[0].effective_ts.toISOString()).toBe(ts)
  })

  it('client soati 1 soat oldinda → clock_adjusted, effective_ts ≤ received', async () => {
    const id = await newDoc()
    const s = { id: uuid(), started_at: new Date().toISOString() }
    const future = new Date(Date.now() + 3600_000).toISOString()
    await save(id, 0, docWith('Hello'), [mutation(s.id, 1, { client_ts: future })], [s])
    const r = await db.query<{ clock_adjusted: boolean; effective_ts: Date; received_at: Date }>(
      'select clock_adjusted, effective_ts, received_at from public.mutations where document_id = $1',
      [id],
    )
    expect(r.rows[0].clock_adjusted).toBe(true)
    expect(r.rows[0].effective_ts.getTime()).toBeLessThanOrEqual(r.rows[0].received_at.getTime())
  })

  it('offline paytda 30+ daqiqa tanaffus: ikkala session ham to‘g‘ri, eskisi yopiladi', async () => {
    const id = await newDoc()
    const s1 = { id: uuid(), started_at: new Date(Date.now() - 120 * 60_000).toISOString() }
    const s2 = { id: uuid(), started_at: new Date(Date.now() - 5 * 60_000).toISOString() }
    const m1 = mutation(s1.id, 1, { client_ts: new Date(Date.now() - 100 * 60_000).toISOString() })
    const m2 = mutation(s2.id, 1, { from: 6, to: 6, client_ts: new Date(Date.now() - 4 * 60_000).toISOString() })
    const r = await save(id, 0, docWith('HelloHello'), [m1, m2], [s1, s2])
    expect(r.status).toBe('ok')
    const ss = await db.query<{ id: string; ended_at: Date | null; end_reason: string | null }>(
      'select id, ended_at, end_reason from public.sessions where document_id = $1 order by started_at',
      [id],
    )
    expect(ss.rows[0]).toMatchObject({ id: s1.id, end_reason: 'idle' })
    expect(ss.rows[0].ended_at).not.toBeNull()
    expect(ss.rows[1]).toMatchObject({ id: s2.id, ended_at: null })
    const tl = await asUser(db, A, () => rpc<{ offline_ranges: unknown[] }>(db, 'document_timeline', { p_document_id: id }))
    expect(tl.offline_ranges.length).toBe(2)
  })
})

describe('RLS va GRANT (A16, A21)', () => {
  it('A16: user B user A hujjati va evidence’ini ko‘ra olmaydi, saqlay olmaydi', async () => {
    const id = await newDoc(A)
    const s = { id: uuid(), started_at: new Date().toISOString() }
    await save(id, 0, docWith('Hello'), [mutation(s.id, 1)], [s], A)
    const seen = await asUser(db, B, async () => {
      const out: Record<string, number> = {}
      for (const t of ['documents', 'mutations', 'snapshots', 'sessions', 'events']) {
        const r = await db.query(`select * from public.${t}`)
        out[t] = r.rows.length
      }
      return out
    })
    expect(seen).toEqual({ documents: 0, mutations: 0, snapshots: 0, sessions: 0, events: 0 })
    await expect(save(id, 1, docWith('Hacked'), [mutation(s.id, 2)], [], B)).rejects.toThrow(/not_found/)
  })

  it('A16: egasi ham mutations/events/snapshots’ni o‘zgartira yoki o‘chira olmaydi', async () => {
    const id = await newDoc(A)
    const s = { id: uuid(), started_at: new Date().toISOString() }
    await save(id, 0, docWith('Hello'), [mutation(s.id, 1)], [s], A)
    for (const sql of [
      `update public.mutations set source = 'typing'`,
      `delete from public.mutations`,
      `delete from public.snapshots`,
      `update public.events set payload = '{}'`,
      `insert into public.snapshots (document_id, document_version, doc_size, content_json, content_text, content_hash, word_count, reason) values ('${id}', 99, 2, '{}', '', '', 0, 'initial')`,
      `update public.documents set content_text = 'x'`,
      `insert into public.documents (user_id, content_json, doc_size) values ('${A}', '{}', 2)`,
    ]) {
      await expect(asUser(db, A, () => db.query(sql))).rejects.toThrow(/permission denied/)
    }
    // title — ruxsat etilgan
    await asUser(db, A, () => db.query(`update public.documents set title = 'New' where id = $1`, [id]))
  })

  it('A21: anon hech bir jadval va funksiyaga kira olmaydi', async () => {
    const tables = ['profiles', 'documents', 'sessions', 'mutations', 'snapshots', 'events']
    for (const t of tables) {
      await expect(asUser(db, null, () => db.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/)
    }
    const fns = [
      `select public.create_document('x')`,
      `select public.save_document(gen_random_uuid(), 0, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      `select public.ingest_events(gen_random_uuid(), '[]'::jsonb, '[]'::jsonb)`,
      `select public.document_timeline(gen_random_uuid())`,
      `select private.pm_doc('{}'::jsonb)`,
    ]
    for (const f of fns) {
      await expect(asUser(db, null, () => db.query(f))).rejects.toThrow(/permission denied/)
    }
  })

  it('authenticated private sxemadagi funksiyalarni chaqira olmaydi', async () => {
    await expect(asUser(db, A, () => db.query(`select private.take_snapshot(null, null, 'initial')`))).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('A11: to‘liq zanjir — recorder → sync → zod → SQL', () => {
  it('2 000 ta tasodifiy tahrir, offline va qayta yuborish bilan: 0 ta unrecorded_change', async () => {
    const id = await newDoc(A)
    const srv = fakeServer(db, A)
    const ed = makeEditor(undefined, Date.now() - 60_000, true)
    const sync = new EvidenceSync({
      documentId: id,
      baseVersion: 0,
      getContent: () => ed.doc.toJSON() as PMJSON,
      store: memoryStore(),
      onStatus: () => undefined,
      onConflict: () => {
        throw new Error('kutilmagan conflict')
      },
      fetch: srv.fetch,
      now: () => ed.clock,
      debounceMs: 10_000_000,
    })
    await sync.start()

    let seed = 7
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    let delivered = 0
    for (let i = 0; i < 2000; i++) {
      const maxPos = ed.doc.content.size - 1
      const pos = 1 + Math.floor(rnd() * Math.max(1, maxPos - 1))
      const r = rnd()
      try {
        if (r < 0.5) {
          ed.select(Math.min(pos, maxPos))
          ed.type(['word ', 'x', ' ', 'é', '😀'][Math.floor(rnd() * 5)])
        } else if (r < 0.65) {
          ed.select(pos, Math.min(pos + 1 + Math.floor(rnd() * 8), maxPos))
          ed.deleteSelection()
        } else if (r < 0.75) {
          ed.select(Math.min(pos, maxPos))
          ed.pasteText('pasted text number ' + i)
        } else if (r < 0.82) {
          ed.select(Math.min(pos, maxPos))
          ed.enter()
        } else if (r < 0.87) ed.wrapBulletList()
        else if (r < 0.93) ed.undo()
        else ed.redo()
      } catch {
        /* bu pozitsiyada buyruq qo'llanmaydi */
      }
      for (const m of ed.mutations.slice(delivered)) sync.onMutation(m)
      delivered = ed.mutations.length

      // vaqti-vaqti bilan: offline, saqlash, internet qaytishi
      if (i % 97 === 0) srv.offline = !srv.offline
      if (i % 40 === 0) await sync.saveNow()
    }
    srv.offline = false
    await sync.saveNow()
    await sync.flush()
    await sync.flushEvents()
    sync.stop()

    expect(srv.errors).toEqual([])
    expect(sync.hasUnsaved()).toBe(false)
    const unrecorded = await events(id, 'unrecorded_change')
    expect(unrecorded).toEqual([])

    const d = await db.query<{ doc_size: number; content_text: string; version: number }>(
      'select doc_size, content_text, version from public.documents where id = $1',
      [id],
    )
    expect(d.rows[0].doc_size).toBe(ed.doc.content.size)
    // yolg'iz surrogate'lar U+FFFD bilan almashtiriladi (uzunlik o'zgarmaydi)
    expect(d.rows[0].content_text).toBe(wellFormed(ed.doc.textBetween(0, ed.doc.content.size, '\n')).normalize('NFC'))

    // ledger yig'indisi = yakuniy hajm − boshlang'ich hajm (2)
    const sum = await db.query<{ s: number }>(
      'select sum(inserted_size - deleted_size)::int as s from public.mutations where document_id = $1',
      [id],
    )
    expect(sum.rows[0].s).toBe(ed.doc.content.size - 2)

    const act = await db.query<{ n: number }>(
      `select count(*)::int as n from public.events where document_id = $1 and type = 'typing_activity'`,
      [id],
    )
    expect(act.rows[0].n).toBeGreaterThan(0)
  })

  it('409: ikkinchi qurilma saqlagan bo‘lsa — local holat Recovered draft', async () => {
    const id = await newDoc(A)
    const srv = fakeServer(db, A)
    const store = memoryStore()
    const ed = makeEditor(undefined, Date.now(), true)
    let conflict: { version: number } | null = null
    const sync = new EvidenceSync({
      documentId: id,
      baseVersion: 0,
      getContent: () => ed.doc.toJSON() as PMJSON,
      store,
      onStatus: () => undefined,
      onConflict: (s) => {
        conflict = s
      },
      fetch: srv.fetch,
      now: () => ed.clock,
      debounceMs: 10_000_000,
    })
    await sync.start()

    // boshqa qurilma avval saqladi
    const other = { id: uuid(), started_at: new Date().toISOString() }
    await save(id, 0, docWith('Other device'), [mutation(other.id, 1, { inserted_size: 12, inserted_chars: 12 })], [other])

    ed.type('mine')
    for (const m of ed.mutations) sync.onMutation(m)
    await sync.saveNow()
    sync.stop()

    expect(conflict).toMatchObject({ version: 1 })
    const draft = await store.getDraft(id)
    expect(JSON.stringify(draft?.content_json)).toContain('mine')
    const c = await db.query<{ n: number }>(
      `select count(*)::int as n from public.mutations where document_id = $1`,
      [id],
    )
    expect(c.rows[0].n).toBe(1) // rad etilgan paket ledger'ga yozilmagan
  })
})
