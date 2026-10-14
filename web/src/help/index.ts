/**
 * The help wiki (ah-ha.app/help): one Markdown file per page in this folder, for people
 * who use the apps, not developers. Plain words, steps, the app's own button names.
 *
 * A page starts with a small header:
 *   ---
 *   title: Lists, 1x and Always
 *   section: Lists and places      (pages are grouped by section, in SECTIONS order)
 *   order: 1                        (position inside the section)
 *   summary: One line for the index and search.
 *   ---
 * Link to another page with [[slug]] or [[slug|words]]; the slug is the file name.
 */
export interface HelpPage { slug: string; title: string; section: string; order: number; summary: string; body: string }

export const SECTIONS = ['Getting started', 'Ah! Today', 'Lists and places', 'Ah! Rhythm', 'Ah! Cart', 'Helpers', 'Help']

const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function parse(path: string, raw: string): HelpPage {
  const slug = path.replace(/^\.\//, '').replace(/\.md$/, '')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const head = Object.fromEntries((m?.[1] ?? '').split('\n').map(l => {
    const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }))
  return {
    slug, title: head['title'] ?? slug, section: head['section'] ?? 'Help',
    order: Number(head['order'] ?? 99), summary: head['summary'] ?? '', body: (m?.[2] ?? raw).trim(),
  }
}

export const PAGES: HelpPage[] = Object.entries(files).map(([p, raw]) => parse(p, raw))
  .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order || a.title.localeCompare(b.title))

export const pageBySlug = (slug: string) => PAGES.find(p => p.slug === slug) ?? null
