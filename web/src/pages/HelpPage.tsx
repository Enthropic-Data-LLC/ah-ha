import { useEffect, useMemo, useState } from 'react'
import { PublicLayout } from './PublicPages'
import Markdown from '../help/Markdown'
import { PAGES, SECTIONS, pageBySlug, type HelpPage as Page } from '../help'

/** Words for search: title, summary and body, without Markdown marks. */
const plain = (p: Page) => `${p.title} ${p.summary} ${p.body}`.replace(/[*`#>[\]|()]/g, ' ').toLowerCase()

function Sidebar({ current }: { current?: string }) {
  return (
    <nav aria-label="Help topics" className="space-y-5 text-sm">
      {SECTIONS.map(section => {
        const pages = PAGES.filter(p => p.section === section)
        if (!pages.length) return null
        return (
          <div key={section}>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">{section}</h2>
            <ul className="space-y-0.5">
              {pages.map(p => (
                <li key={p.slug}>
                  <a href={`/help/${p.slug}`} aria-current={p.slug === current ? 'page' : undefined}
                    className={`block rounded-md px-2 py-1.5 transition ${p.slug === current ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'}`}>
                    {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function Index() {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? PAGES.filter(p => words.every(w => plain(p).includes(w))) : null
  }, [q])
  return (
    <div className="max-w-3xl mx-auto px-6 pb-16 space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-slate-50">Help</h1>
        <p className="text-slate-300">How to use Ah-Ha, Ah! Today, Ah! Rhythm and Ah! Cart, step by step.</p>
        <label className="block">
          <span className="sr-only">Search help</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search help, e.g. “always”, “reminders”, “install”"
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </label>
      </header>

      {hits ? (
        <section aria-live="polite" className="space-y-2">
          <p className="text-xs text-slate-500">{hits.length ? `${hits.length} page${hits.length === 1 ? '' : 's'}` : 'No pages match. Try fewer words.'}</p>
          {hits.map(p => <Card key={p.slug} page={p} />)}
        </section>
      ) : SECTIONS.map(section => {
        const pages = PAGES.filter(p => p.section === section)
        if (!pages.length) return null
        return (
          <section key={section} className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-400">{section}</h2>
            <div className="grid sm:grid-cols-2 gap-2">{pages.map(p => <Card key={p.slug} page={p} />)}</div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ page }: { page: Page }) {
  return (
    <a href={`/help/${page.slug}`} className="block rounded-xl border border-slate-800 bg-slate-900/40 hover:border-slate-600 px-4 py-3 transition">
      <span className="block font-medium text-slate-100">{page.title}</span>
      <span className="block text-xs text-slate-400 mt-0.5">{page.summary}</span>
    </a>
  )
}

function Article({ page }: { page: Page }) {
  const i = PAGES.indexOf(page), prev = PAGES[i - 1], next = PAGES[i + 1]
  return (
    <div className="max-w-5xl mx-auto px-6 pb-16 grid md:grid-cols-[14rem_1fr] gap-10">
      <aside className="hidden md:block pt-1"><Sidebar current={page.slug} /></aside>
      <article className="min-w-0 space-y-4 text-[15px] leading-relaxed text-slate-300 [&_a]:text-indigo-300 [&_a]:underline [&_a]:underline-offset-4 [&_strong]:text-slate-100">
        <p className="text-xs text-slate-500"><a href="/help" className="!text-slate-400 !no-underline hover:!text-slate-200">Help</a> › {page.section}</p>
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-50">{page.title}</h1>
          {page.summary && <p className="text-slate-400">{page.summary}</p>}
        </header>
        <Markdown source={page.body} />
        <nav aria-label="More help" className="flex justify-between gap-4 pt-8 border-t border-slate-800 text-sm">
          {prev ? <a href={`/help/${prev.slug}`}>← {prev.title}</a> : <span />}
          {next ? <a href={`/help/${next.slug}`} className="text-right">{next.title} →</a> : <span />}
        </nav>
        <details className="md:hidden pt-2">
          <summary className="cursor-pointer text-sm text-slate-400 py-2">All help topics</summary>
          <div className="pt-2"><Sidebar current={page.slug} /></div>
        </details>
      </article>
    </div>
  )
}

/** /help and /help/<slug>: the public help wiki. */
export default function HelpPage({ path }: { path: string }) {
  const slug = path.replace(/^\/help\/?/, '').replace(/\/$/, '')
  const page = slug ? pageBySlug(slug) : null
  useEffect(() => { document.title = page ? `${page.title} · Ah-Ha Help` : 'Help · Ah-Ha' }, [page])
  return (
    <PublicLayout>
      {slug && !page ? (
        <div className="max-w-3xl mx-auto px-6 pb-16 space-y-3">
          <h1 className="text-2xl font-bold text-slate-50">Page not found</h1>
          <p className="text-slate-300">There's no help page called “{slug}”. <a href="/help" className="text-indigo-300 underline">See all help topics</a>.</p>
        </div>
      ) : page ? <Article page={page} /> : <Index />}
    </PublicLayout>
  )
}
