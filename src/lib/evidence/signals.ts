/**
 * Foydalanuvchi kiritish signallari.
 *
 * ProseMirror oddiy yozishni asosan DOM o'zgarishidan o'qiydi, Enter/Backspace
 * keymap orqali ishlaydi, Android klaviaturalari deyarli hamma narsani
 * composition sifatida yuboradi. Shuning uchun manba faqat beforeinput'dan emas,
 * tranzaksiya meta'lari + shu signallar birgalikda aniqlanadi (recorder.ts).
 *
 * Faqat isTrusted event'lar hisobga olinadi: skript yaratgan sintetik event
 * user kiritishi sifatida sanalmaydi.
 */
export interface SignalState {
  lastUserInputAt: number
  lastReplacementAt: number
  lastPasteAt: number
  lastDropAt: number
  composing: boolean
}

export class InputSignals implements SignalState {
  lastUserInputAt = Number.NEGATIVE_INFINITY
  lastReplacementAt = Number.NEGATIVE_INFINITY
  lastPasteAt = Number.NEGATIVE_INFINITY
  lastDropAt = Number.NEGATIVE_INFINITY
  composing = false
  private compositionEndListeners = new Set<() => void>()

  constructor(private now: () => number = () => Date.now()) {}

  onCompositionEnd(fn: () => void): () => void {
    this.compositionEndListeners.add(fn)
    return () => this.compositionEndListeners.delete(fn)
  }

  /** Editor DOM'iga ulanadi (capture fazasi — ProseMirror'dan oldin ishlaydi). */
  attach(dom: HTMLElement): () => void {
    const opts = { capture: true } as const
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isTrusted) this.lastUserInputAt = this.now()
    }
    const onBeforeInput = (e: Event) => {
      if (!e.isTrusted) return
      const type = (e as InputEvent).inputType ?? ''
      const t = this.now()
      if (type === 'insertReplacementText') this.lastReplacementAt = t
      else if (type === 'insertFromPaste' || type === 'insertFromPasteAsQuotation' || type === 'insertFromYank')
        this.lastPasteAt = t
      else if (type === 'insertFromDrop') this.lastDropAt = t
      else this.lastUserInputAt = t
    }
    const onCompositionStart = (e: Event) => {
      if (!e.isTrusted) return
      this.composing = true
      this.lastUserInputAt = this.now()
    }
    const onCompositionUpdate = (e: Event) => {
      if (e.isTrusted) this.lastUserInputAt = this.now()
    }
    const onCompositionEnd = (e: Event) => {
      if (!e.isTrusted) return
      this.composing = false
      this.lastUserInputAt = this.now()
      this.compositionEndListeners.forEach((fn) => fn())
    }
    const onPaste = (e: Event) => {
      if (e.isTrusted) this.lastPasteAt = this.now()
    }
    const onDrop = (e: Event) => {
      if (e.isTrusted) this.lastDropAt = this.now()
    }

    dom.addEventListener('keydown', onKeyDown, opts)
    dom.addEventListener('beforeinput', onBeforeInput, opts)
    dom.addEventListener('compositionstart', onCompositionStart, opts)
    dom.addEventListener('compositionupdate', onCompositionUpdate, opts)
    dom.addEventListener('compositionend', onCompositionEnd, opts)
    dom.addEventListener('paste', onPaste, opts)
    dom.addEventListener('drop', onDrop, opts)
    return () => {
      dom.removeEventListener('keydown', onKeyDown, opts)
      dom.removeEventListener('beforeinput', onBeforeInput, opts)
      dom.removeEventListener('compositionstart', onCompositionStart, opts)
      dom.removeEventListener('compositionupdate', onCompositionUpdate, opts)
      dom.removeEventListener('compositionend', onCompositionEnd, opts)
      dom.removeEventListener('paste', onPaste, opts)
      dom.removeEventListener('drop', onDrop, opts)
    }
  }

  /** Toolbar tugmalari kabi o'z UI'imizdan kelgan amal (user harakati) */
  markUserAction(): void {
    this.lastUserInputAt = this.now()
  }
}
