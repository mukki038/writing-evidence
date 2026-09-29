'use client'
import type { Composition } from '@/lib/evidence/composition'
import { formatDuration, summarize, type TimelineData, type TimelineEvent } from '@/lib/evidence/timeline'
import type { Dict, Locale } from '@/lib/i18n'
import { CompositionBar } from './CompositionBar'
import { Time } from './Time'

interface Props {
  data: TimelineData
  composition: Composition | null
  t: Dict
  locale: Locale
  compact?: boolean
}

/** Writing Evidence Timeline (TZ §16) — barcha belgilar neytral tilda. */
export function TimelineView({ data, composition, t, locale, compact }: Props) {
  const s = summarize(data)
  const tl = t.tl
  const stats: Array<[string, string | number, boolean?]> = [
    [tl.sessions, s.sessions],
    [tl.activeTime, formatDuration(s.activeSec, tl)],
    [tl.finalWords, s.words],
    [tl.externalInserts, s.externalInserts],
    [tl.moves, s.moves],
    [tl.revisions, s.revisions],
    [tl.unrecorded, s.unrecorded, s.unrecorded > 0],
    [tl.offline, s.offlineRanges ? `${s.offlineRanges} · ${formatDuration(s.offlineSec, tl)}` : 0],
  ]
  if (s.clockAdjusted) stats.push([tl.clockAdjusted, s.clockAdjusted])

  return (
    <div className={`timeline ${compact ? 'timeline--compact' : ''}`}>
      {!compact && (
        <dl className="tl-period">
          <div>
            <dt>{tl.firstWriting}</dt>
            <dd>{s.firstWriting ? <Time iso={s.firstWriting} locale={locale} /> : '—'}</dd>
          </div>
          <div>
            <dt>{tl.period}</dt>
            <dd>
              {s.firstWriting ? <Time iso={s.firstWriting} locale={locale} /> : '—'} →{' '}
              {s.lastWriting ? <Time iso={s.lastWriting} locale={locale} /> : '—'}
            </dd>
          </div>
        </dl>
      )}

      <dl className="stat-grid">
        {stats.map(([label, value, flag]) => (
          <div key={label} className={`stat ${flag ? 'stat--flag' : ''}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="tl-section">
        <h3>{tl.composition}</h3>
        <CompositionBar c={composition} t={t} />
      </section>

      {data.snapshots.length > 1 && (
        <section className="tl-section">
          <h3>{tl.growth}</h3>
          <GrowthChart points={data.snapshots.map((p) => ({ t: Date.parse(p.created_at), w: p.word_count }))} />
        </section>
      )}

      {!compact && data.sessions.length > 0 && (
        <section className="tl-section">
          <h3>{tl.sessionList}</h3>
          <ol className="session-list">
            {data.sessions.map((se) => (
              <li key={se.id}>
                <span>
                  <Time iso={se.started_at} locale={locale} /> →{' '}
                  {se.ended_at ? <Time iso={se.ended_at} locale={locale} date={false} /> : <em>{tl.ongoing}</em>}
                </span>
                <span className="muted">{formatDuration(se.active_sec, tl)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="tl-section">
        <h3>{tl.events}</h3>
        <EventList data={data} t={t} locale={locale} />
      </section>
    </div>
  )
}

function EventList({ data, t, locale }: { data: TimelineData; t: Dict; locale: Locale }) {
  const items: Array<{ ts: string; node: React.ReactNode; tone?: string }> = []
  for (const e of data.events) items.push({ ts: e.effective_ts, node: describe(e, t), tone: e.type })
  for (const r of data.offline_ranges) {
    items.push({
      ts: r.started_at,
      tone: 'offline',
      node: (
        <>
          {t.tl.ev.offline}: <Time iso={r.started_at} locale={locale} date={false} /> –{' '}
          <Time iso={r.ended_at} locale={locale} date={false} />, <Time iso={r.synced_at} locale={locale} date={false} />{' '}
          {t.tl.ev.synced}
        </>
      ),
    })
  }
  items.sort((a, b) => a.ts.localeCompare(b.ts))
  if (!items.length) return <p className="muted">{t.tl.noEvents}</p>
  return (
    <ol className="event-list">
      {items.slice(-200).map((it, i) => (
        <li key={i} className={`ev ev--${it.tone}`}>
          <span className="ev-time">
            <Time iso={it.ts} locale={locale} />
          </span>
          <span>{it.node}</span>
        </li>
      ))}
    </ol>
  )
}

function describe(e: TimelineEvent, t: Dict): React.ReactNode {
  const n = Number(e.payload.inserted_chars ?? 0)
  switch (e.type) {
    case 'text_inserted':
      return (
        <>
          {t.tl.ev.text_inserted}: {t.origin[String(e.payload.source)] ?? String(e.payload.source)}, {n} {t.tl.chars}
        </>
      )
    case 'text_moved':
      return (
        <>
          {t.tl.ev.text_moved}: {n} {t.tl.chars}
        </>
      )
    case 'revision':
      return (
        <>
          {t.tl.ev.revision}: {Number(e.payload.deleted_chars)} {t.tl.chars} {t.tl.deleted}
        </>
      )
    case 'unrecorded_change':
      return t.tl.ev.unrecorded_change
  }
}

function GrowthChart({ points }: { points: Array<{ t: number; w: number }> }) {
  const W = 600
  const H = 120
  const pad = 8
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const maxW = Math.max(1, ...points.map((p) => p.w))
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad)
  const y = (w: number) => H - pad - (w / maxW) * (H - 2 * pad)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ')
  return (
    <svg className="growth" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`0 → ${points[points.length - 1].w}`}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="growth-axis" />
      <path d={d} className="growth-line" vectorEffect="non-scaling-stroke" />
      <text x={W - pad} y={pad + 10} textAnchor="end" className="growth-label">
        {maxW}
      </text>
    </svg>
  )
}
