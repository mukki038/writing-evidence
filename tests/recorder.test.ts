import { describe, expect, it } from 'vitest'
import { Slice, Fragment } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { makeEditor } from './editor-harness'
import { composition } from '../src/lib/evidence/composition'
import { originOf } from '../src/lib/evidence/recorder'

function sumDelta(ms: { inserted_size: number; deleted_size: number }[]) {
  return ms.reduce((a, m) => a + m.inserted_size - m.deleted_size, 0)
}

describe('manba aniqlash (TZ §10.5)', () => {
  it('klaviatura signali bilan yozish → typing, origin mark yo‘q', () => {
    const ed = makeEditor()
    ed.type('Hello')
    expect(ed.mutations.map((m) => m.source)).toEqual(['typing', 'typing', 'typing', 'typing', 'typing'])
    expect(composition(ed.doc).typed).toBe(5)
  })

  it('A7: 500 belgili tashqi paste → paste va origin: paste', () => {
    const ed = makeEditor()
    ed.pasteText('x'.repeat(500))
    const m = ed.mutations.at(-1)!
    expect(m.source).toBe('paste')
    expect(m.inserted_chars).toBe(500)
    expect(composition(ed.doc).paste).toBe(500)
  })

  it('tashqi paste: clipboard’dagi origin ma’lumoti e’tiborsiz qoldiriladi', () => {
    const ed = makeEditor()
    // clipboard matni "typed" bo'lib ko'rinishga urinsa ham (mark'siz) yoki boshqa origin bilan kelsa ham
    ed.pasteText('forged text here', [{ type: 'origin', attrs: { source: 'recovered' } }])
    const c = composition(ed.doc)
    expect(c.paste).toBe(16)
    expect(c.recovered).toBe(0)
  })

  it('A9: 100 belgili bitta insertText → bulk_input, typing’ga qo‘shilmaydi', () => {
    const ed = makeEditor()
    ed.typeChunk('y'.repeat(100))
    expect(ed.mutations.at(-1)!.source).toBe('bulk_input')
    expect(composition(ed.doc)).toMatchObject({ typed: 0, bulk_input: 100 })
  })

  it('39 belgili chunk → typing (chegara 40)', () => {
    const ed = makeEditor()
    ed.typeChunk('z'.repeat(39))
    expect(ed.mutations.at(-1)!.source).toBe('typing')
  })

  it('A9: spellcheck (insertReplacementText) → replacement', () => {
    const ed = makeEditor()
    ed.type('teh')
    ed.select(1, 4)
    ed.tick(50)
    ed.signals.lastReplacementAt = ed.clock
    ed.dispatch(ed.state.tr.insertText('the'))
    expect(ed.mutations.at(-1)!.source).toBe('replacement')
    expect(composition(ed.doc).replacement).toBe(3)
  })

  it('user signalisiz DOM o‘zgarishi (extension) → unknown', () => {
    const ed = makeEditor()
    ed.silentInsert('injected')
    expect(ed.mutations.at(-1)!.source).toBe('unknown')
    expect(composition(ed.doc).unknown).toBe(8)
  })

  it('o‘chirish → delete, cut → delete', () => {
    const ed = makeEditor()
    ed.type('abcdef')
    ed.select(2, 4)
    ed.deleteSelection()
    expect(ed.mutations.at(-1)).toMatchObject({ source: 'delete', deleted_chars: 2, inserted_chars: 0 })
    ed.select(1, 3)
    ed.cut()
    expect(ed.mutations.at(-1)!.source).toBe('delete')
  })

  it('bold/italic (faqat mark) → mutation yozilmaydi; Enter va ro‘yxat → hajm aniq', () => {
    const ed = makeEditor()
    ed.type('abc')
    const before = ed.mutations.length
    ed.toggleBold(1, 4)
    expect(ed.mutations.length).toBe(before)
    const size0 = ed.doc.content.size
    ed.enter()
    ed.wrapBulletList()
    const tail = ed.mutations.slice(before)
    expect(tail.every((m) => m.inserted_chars === 0)).toBe(true)
    expect(sumDelta(tail)).toBe(ed.doc.content.size - size0)
  })
})

describe('ichki ko‘chirish (TZ §10.6, A8)', () => {
  it('hujjat ichidagi cut/paste → moved, asl origin’lar saqlanadi', () => {
    const ed = makeEditor()
    ed.type('Hello ')
    ed.pasteText('PASTED')
    ed.type(' end')
    const end = ed.endPos()
    // butun qatorni kesib, qayta joylash
    ed.select(1, end)
    const slice = ed.state.doc.slice(1, end)
    ed.cut()
    ed.paste(slice)
    const m = ed.mutations.at(-1)!
    expect(m.source).toBe('moved')
    expect(composition(ed.doc)).toMatchObject({ typed: 10, paste: 6 })
  })

  it('clipboard mark’larini olib tashlash yordam bermaydi: run’lar qayta qo‘llanadi', () => {
    const ed = makeEditor()
    ed.pasteText('external words')
    ed.select(1, ed.endPos())
    ed.copy()
    ed.select(ed.endPos())
    // clipboard HTML'dan mark'lar yo'qolgan (masalan, tashqi dastur orqali o'tgan)
    ed.pasteText('external words')
    expect(ed.mutations.at(-1)!.source).toBe('moved')
    expect(composition(ed.doc).paste).toBe(28)
    expect(composition(ed.doc).typed).toBe(0)
  })

  it('matn mos kelmasa → paste', () => {
    const ed = makeEditor()
    ed.type('abc')
    ed.select(1, 4)
    ed.copy()
    ed.select(4)
    ed.pasteText('abd')
    expect(ed.mutations.at(-1)!.source).toBe('paste')
  })
})

describe('origin mark holat qoidalari (TZ §10.7)', () => {
  it('A23: AI 100 → 40 o‘chirish, 20 ustidan yozish, 30 ichiga yozish → ai = 40, typed = 50', () => {
    const ed = makeEditor()
    ed.insertAi('a'.repeat(100)) // pos 1..101
    expect(composition(ed.doc).ai).toBe(100)

    // 40 ta o'chirish
    ed.select(1, 41)
    ed.deleteSelection() // qoldi: 60 ai (pos 1..61)

    // 20 tasini tanlab ustidan yozish (belgima-belgi)
    ed.select(1, 21)
    ed.type('b'.repeat(20)) // birinchi belgi tanlovni almashtiradi

    // AI matn ichiga 30 ta belgi yozish
    const mid = 21 + 20
    ed.select(mid)
    ed.type('c'.repeat(30))

    const c = composition(ed.doc)
    expect(c.ai).toBe(40)
    expect(c.typed).toBe(50)
  })

  it('mark’li matn ichida yozilgan belgi typed (ProseMirror mark’ni meros qilsa ham)', () => {
    const ed = makeEditor()
    ed.insertAi('xxxxxxxxxx')
    ed.select(6)
    ed.type('Y')
    // pos 6 → paragraf ichidagi offset 5
    const yNode = ed.doc.firstChild!.childAfter(5).node!
    expect(yNode.text).toBe('Y')
    expect(originOf(yNode.marks)).toBeNull()
  })

  it('undo/redo: hujjat mark’lari bilan oldingi holatga qaytadi', () => {
    const ed = makeEditor()
    ed.type('abc')
    ed.dispatch(closeHistory(ed.state.tr))
    ed.pasteText('PPP')
    expect(composition(ed.doc).paste).toBe(3)
    ed.dispatch(closeHistory(ed.state.tr))
    ed.undo()
    expect(ed.mutations.at(-1)!.source).toBe('history')
    expect(composition(ed.doc)).toMatchObject({ typed: 3, paste: 0 })
    ed.redo()
    expect(composition(ed.doc)).toMatchObject({ typed: 3, paste: 3 })
  })

  it('recovered va ai — o‘z kodimiz meta orqali belgilaydi', () => {
    const ed = makeEditor()
    ed.tick(100)
    ed.dispatch(ed.state.tr.insertText('draft text').setMeta('evidence.source', 'recovered'))
    expect(ed.mutations.at(-1)!.source).toBe('recovered')
    expect(composition(ed.doc).recovered).toBe(10)
  })

  it('IME composition paytida origin olib tashlash kechiktiriladi va keyin qo‘llanadi', () => {
    const ed = makeEditor()
    ed.insertAi('aaaaaaaaaa')
    ed.select(6)
    ed.signals.composing = true
    ed.tick(50)
    ed.userSignal()
    ed.dispatch(ed.state.tr.insertText('k'))
    // composition davomida mark tegmaydi
    expect(composition(ed.doc).ai).toBe(11)
    ed.signals.composing = false
    // applyDeferred view talab qiladi — view o'rnida minimal obyekt
    const fakeView = {
      get state() {
        return ed.state
      },
      dispatch: (tr: Parameters<typeof ed.dispatch>[0]) => ed.dispatch(tr),
    }
    ed.recorder.applyDeferred(fakeView as never)
    expect(composition(ed.doc)).toMatchObject({ ai: 10, typed: 1 })
  })
})

describe('mutation hajmlari: har doim aniq (A11 client qismi)', () => {
  it('10 000 ta tasodifiy tahrirda Σ(inserted − deleted) = hajm farqi', () => {
    const ed = makeEditor()
    let seed = 42
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const size0 = ed.doc.content.size
    const words = ['alpha ', 'beta ', 'gamma ', 'delta ', 'x', ' ', '😀', 'é']
    for (let i = 0; i < 10_000; i++) {
      const before = ed.mutations.length
      const sizeBefore = ed.doc.content.size
      const r = rnd()
      const maxPos = ed.doc.content.size - 1
      const pos = 1 + Math.floor(rnd() * Math.max(1, maxPos - 1))
      try {
        ed.select(Math.min(pos, maxPos))
      } catch {
        continue // matn bo'lmagan pozitsiya
      }
      if (r < 0.45) ed.type(words[Math.floor(rnd() * words.length)])
      else if (r < 0.6) {
        const to = Math.min(pos + 1 + Math.floor(rnd() * 12), maxPos)
        try {
          ed.select(pos, to)
          ed.deleteSelection()
        } catch {
          /* noto'g'ri tanlov */
        }
      } else if (r < 0.7) ed.pasteText('pasted chunk ' + i)
      else if (r < 0.75) ed.insertAi('ai suggestion text')
      else if (r < 0.85) {
        try {
          if (r < 0.82) ed.enter()
          else ed.wrapBulletList()
        } catch {
          /* ProseMirror buyrug'i bu pozitsiyada qo'llanmaydi */
        }
      }
      else if (r < 0.88) ed.toggleBold(1, Math.min(5, maxPos))
      else if (r < 0.94) ed.undo()
      else if (r < 0.97) ed.redo()
      else {
        const slice = new Slice(Fragment.from(ed.state.schema.text('drop')), 0, 0)
        ed.tick(100)
        ed.signals.lastDropAt = ed.clock
        ed.dispatch(ed.state.tr.replaceSelection(slice).setMeta('uiEvent', 'drop'))
      }
      const delta = sumDelta(ed.mutations.slice(before))
      expect(delta).toBe(ed.doc.content.size - sizeBefore)
    }
    expect(sumDelta(ed.mutations)).toBe(ed.doc.content.size - size0)
    // tarkib yig'indisi = jami matn uzunligi (har belgi bitta toifada)
    const c = composition(ed.doc)
    const total = Object.values(c).reduce((a, b) => a + b, 0)
    expect(total).toBe(ed.doc.textContent.length)
    expect(ed.mutations.length).toBeGreaterThan(5000)
  })
})
