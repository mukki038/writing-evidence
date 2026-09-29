/**
 * Cheklangan editor schema (TZ v4 §9): paragraph, heading (H1–H3), bold, italic,
 * bullet/ordered list, blockquote + ko'rinmas origin mark.
 * Bu ro'yxat server validatsiyasi (private.pm_node) bilan mos bo'lishi shart.
 */
import { Extension, Mark, getSchema, type AnyExtension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Blockquote from '@tiptap/extension-blockquote'
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list'
import type { Recorder } from '../evidence/recorder'

/**
 * Origin mark (TZ §10.7). Clipboard HTML'dan HECH QACHON o'qilmaydi
 * (parseHTML bo'sh) — tashqi paste'da origin ma'lumotiga ishonilmaydi.
 */
export const OriginMark = Mark.create({
  name: 'origin',
  excludes: 'origin',
  addAttributes() {
    return {
      source: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attrs) => (attrs.source ? { 'data-origin': attrs.source } : {}),
      },
    }
  },
  parseHTML() {
    return []
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },
})

export const schemaExtensions: AnyExtension[] = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  OriginMark,
]

export const editorSchema = getSchema(schemaExtensions)

/** Recorder plugin'ini TipTap'ga ulaydi */
export const EvidenceRecorder = Extension.create<{ recorder: Recorder | null }>({
  name: 'evidenceRecorder',
  priority: 1000,
  addOptions() {
    return { recorder: null }
  },
  addProseMirrorPlugins() {
    return this.options.recorder ? [this.options.recorder.plugin] : []
  },
})

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
