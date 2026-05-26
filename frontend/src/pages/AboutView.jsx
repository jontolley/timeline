/* global __BUILD_COMMIT__, __BUILD_TIME__ */

const COMMIT = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev'
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

function formatBuildTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function AboutView() {
  const isDev = COMMIT === 'dev'
  const commitHref = isDev ? null : `https://github.com/jontolley/timeline/commit/${COMMIT}`

  return (
    <main className="about-page">
      <header className="about-head">
        <p className="about-eyebrow"><span className="pip" /> About</p>
        <h1 className="about-title">Hindsite<em>.</em></h1>
        <p className="about-tag">Look back, on purpose.</p>
      </header>

      <section className="about-block">
        <dl className="about-meta">
          <div>
            <dt>Build</dt>
            <dd>
              {commitHref ? (
                <a href={commitHref} target="_blank" rel="noreferrer noopener">{COMMIT}</a>
              ) : (
                <span>{COMMIT}</span>
              )}
            </dd>
          </div>
          {BUILD_TIME && (
            <div>
              <dt>Built</dt>
              <dd>{formatBuildTime(BUILD_TIME)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="about-block">
        <p className="about-body">
          A self-hosted timeline for personal life events with AI-powered chat.
          Add events by typing into a chat box, search and ask questions across
          your history with semantic retrieval, attach photos, and tag people.
        </p>
        <p className="about-body">
          Source on <a href="https://github.com/jontolley/timeline" target="_blank" rel="noreferrer noopener">GitHub</a> · MIT licensed.
        </p>
      </section>
    </main>
  )
}
