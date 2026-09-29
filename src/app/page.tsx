import Link from 'next/link'
import { getDict } from '@/lib/i18n-server'

export default async function Home() {
  const { t } = await getDict()
  const l = t.landing
  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Academic Authorship &amp; Writing Evidence</p>
        <h1>{t.tagline}</h1>
        <p className="lead">{l.lead}</p>
        <div className="cta-row">
          <Link href="/demo" className="btn btn--primary btn--large">
            {l.ctaDemo}
          </Link>
          <Link href="/signup" className="btn btn--large">
            {l.ctaSignup}
          </Link>
        </div>
        <p className="note">{l.notDetector}</p>
      </section>

      <section className="how">
        <h2>{l.how}</h2>
        <ol className="steps">
          {l.steps.map(([title, body], i) => (
            <li key={title}>
              <span className="step-n">{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="principle">
        <blockquote>{l.principle}</blockquote>
        <p className="muted small">{l.limits}</p>
      </section>
    </div>
  )
}
