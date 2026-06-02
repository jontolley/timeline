/* Plain-conversational privacy policy. Reachable at /privacy from the landing
 * page footer and from inside the authenticated app. Last updated lives at the
 * top of the page; bump it whenever the policy text changes. */

import { useEffect } from 'react'

const LAST_UPDATED = '2026-05-28'

/* Hindsite brandmark + wordmark, matching the Topbar version exactly so
 * the privacy page reads as a real Hindsite page rather than a stranded
 * legal doc. Plain <a href="/"> so it works in both signed-in and
 * signed-out states (the latter has no Topbar). */
function PrivacyBrand() {
  return (
    <a href="/" className="privacy-brand" aria-label="Hindsite home">
      <span className="privacy-brand-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="16" cy="16" r="2" fill="currentColor" />
          <path d="M16 6 V 13 M22 24 L 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="privacy-brand-word">Hindsite</span>
    </a>
  )
}

export default function PrivacyView() {
  /* Override the static index.html canonical (which points at the apex
   * homepage) so /privacy self-references rather than getting folded into
   * "/". Restored to the homepage on unmount for SPA navigations. */
  useEffect(() => {
    const link = document.querySelector('link[rel="canonical"]')
    if (!link) return
    const prev = link.getAttribute('href')
    link.setAttribute('href', 'https://hindsite.app/privacy')
    return () => link.setAttribute('href', prev)
  }, [])

  return (
    <main className="privacy-page">
      <PrivacyBrand />
      <header className="privacy-head">
        <p className="privacy-eyebrow"><span className="pip" /> Privacy</p>
        <h1 className="privacy-title">A short, honest note on your <em>data.</em></h1>
        <p className="privacy-updated">Last updated {LAST_UPDATED}</p>
      </header>

      <section className="privacy-block">
        <p>
          Hindsite is a small, self-hosted personal timeline app. The source
          code is public on{' '}
          <a href="https://github.com/jontolley/timeline" target="_blank" rel="noreferrer noopener">GitHub</a>{' '}
          (MIT licensed). There's no company behind it, no investors, no ads,
          no monetization — just a single instance you sign in to and log
          moments from your own life. This page explains what data the app
          handles and where it goes, in plain English.
        </p>
      </section>

      <section className="privacy-block">
        <h2>What Hindsite collects</h2>
        <ul>
          <li>Your email address, used to sign you in.</li>
          <li>Your name and profile picture, only if you choose "Continue with Google" to sign in (these come from your Google account claims).</li>
          <li>Everything you choose to log: events you create, descriptions, dates, locations, tags, photos, videos, audio clips, and the names of people you tag.</li>
          <li>A single signed session cookie (<code>HttpOnly</code>, <code>Secure</code>, <code>SameSite=Lax</code>) so you stay signed in between visits.</li>
        </ul>
      </section>

      <section className="privacy-block">
        <h2>Where your data lives</h2>
        <p>
          The Hindsite instance is hosted across a few specialized providers:
        </p>
        <ul>
          <li><strong>MongoDB Atlas</strong> stores your text content (events, people, threads).</li>
          <li><strong>Cloudflare R2</strong> stores your photos, videos, and audio clips.</li>
          <li><strong>Fly.io</strong> runs the backend code that ties everything together.</li>
          <li><strong>Qdrant</strong> (also on Fly) stores vector embeddings that power the chat search.</li>
          <li><strong>Cloudflare Pages</strong> serves the website itself.</li>
        </ul>
        <p>
          These are all hosting providers — they store data on Hindsite's
          behalf and don't read it or use it for anything else.
        </p>
      </section>

      <section className="privacy-block">
        <h2>Who else sees your content</h2>
        <p>
          Some features send your data to third-party services to do their
          work. The full list:
        </p>
        <ul>
          <li><strong>Anthropic (Claude)</strong> receives the text of your events when you use the chat feature, and receives any photos you run through "Photo with AI captions" so it can write the title and description for you.</li>
          <li><strong>OpenAI</strong> receives the text of every event you create or edit so it can generate the vector embeddings that power semantic search inside chat.</li>
          <li><strong>Google</strong> sees your email address and basic profile info (name, picture URL) if you choose "Continue with Google" to sign in.</li>
          <li><strong>Resend</strong> delivers transactional sign-in and invitation emails — it sees recipient addresses and the message body.</li>
          <li><strong>OpenStreetMap / Nominatim</strong> receives location names you type so it can convert them to map coordinates.</li>
        </ul>
        <p>
          These are reputable providers with their own privacy policies.
          Hindsite doesn't share your data with anyone else.
        </p>
      </section>

      <section className="privacy-block">
        <h2>Sharing inside Hindsite</h2>
        <p>
          You can mark a thread as "shared" and invite specific other Hindsite
          users to see it. They get a read-only view of the events in that
          thread on their own timeline. They can't edit your events. No one
          else on the same Hindsite instance sees your data without you
          explicitly sharing it.
        </p>
      </section>

      <section className="privacy-block">
        <h2>What Hindsite doesn't do</h2>
        <ul>
          <li>No advertising of any kind.</li>
          <li>No analytics tracking — no Google Analytics, no Mixpanel, no third-party scripts watching your sessions.</li>
          <li>No selling, renting, or trading your data.</li>
          <li>No tracking pixels or third-party cookies.</li>
          <li>No data shared beyond the specific providers listed above.</li>
        </ul>
      </section>

      <section className="privacy-block">
        <h2>Your data, your control</h2>
        <ul>
          <li>You can delete any event at any time. Deleting an event also removes its photos/videos/audio from R2 and its vector embedding from Qdrant.</li>
          <li>You can export any thread you own (with its events and the people referenced) to a JSON file from <em>Settings → Threads → Export</em>.</li>
          <li>If you want your entire account deleted, email the address at the bottom of this page and I'll remove the account along with all events, media, people, threads, and embeddings tied to it.</li>
        </ul>
      </section>

      <section className="privacy-block">
        <h2>Cookies</h2>
        <p>
          Hindsite sets exactly one cookie: a signed session token, marked{' '}
          <code>HttpOnly</code>, <code>Secure</code>, and{' '}
          <code>SameSite=Lax</code>, used to keep you signed in. There are no
          tracking, analytics, or advertising cookies.
        </p>
      </section>

      <section className="privacy-block">
        <h2>Children</h2>
        <p>Hindsite isn't designed for users under 13.</p>
      </section>

      <section className="privacy-block">
        <h2>Changes to this policy</h2>
        <p>
          If this policy changes, the "Last updated" date at the top of this
          page will change too. Material changes will also be flagged in-app
          on your next sign-in.
        </p>
      </section>

      <section className="privacy-block">
        <h2>Contact</h2>
        <p>
          Questions, concerns, or account-deletion requests:{' '}
          <a href="mailto:info@hindsite.app">info@hindsite.app</a>.
        </p>
      </section>

      <p className="privacy-back">
        <a href="/">← Back to Hindsite</a>
      </p>
    </main>
  )
}
