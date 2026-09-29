import { ORIGIN_SOURCES } from '@/lib/evidence/constants'
import type { Composition } from '@/lib/evidence/composition'
import type { Dict } from '@/lib/i18n'

const ORDER = ['typed', ...ORIGIN_SOURCES] as const

/** Final matn tarkibi — foizlar faqat o'lchangan belgilardan; ma'lumot yo'q bo'lsa "mavjud emas". */
export function CompositionBar({ c, t }: { c: Composition | null; t: Dict }) {
  const total = c ? Object.values(c).reduce((a, b) => a + b, 0) : 0
  if (!c || total === 0) {
    return (
      <div className="composition">
        <p className="muted small">{t.tl.compositionNA}</p>
      </div>
    )
  }
  const parts = ORDER.filter((k) => c[k] > 0).map((k) => ({ k, v: c[k], pct: (c[k] / total) * 100 }))
  return (
    <div className="composition">
      <div className="comp-bar" role="img" aria-label={parts.map((p) => `${t.origin[p.k]} ${p.pct.toFixed(1)}%`).join(', ')}>
        {parts.map((p) => (
          <span key={p.k} className={`comp-seg origin-${p.k}`} style={{ width: `${p.pct}%` }} />
        ))}
      </div>
      <ul className="comp-legend">
        {parts.map((p) => (
          <li key={p.k}>
            <span className={`swatch origin-${p.k}`} aria-hidden />
            <span>{t.origin[p.k]}</span>
            <strong>{p.pct.toFixed(1)}%</strong>
            <span className="muted small">
              ({p.v} {t.tl.chars})
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">{t.tl.compositionNote}</p>
    </div>
  )
}
