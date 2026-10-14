import type { ReactNode } from 'react'

/**
 * A small Markdown renderer for the help pages, straight to React elements: no HTML is
 * ever injected. Covers what the pages use: ## / ### headings, paragraphs, - and 1.
 * lists (nested by two-space indent), > callouts, **bold**, *italic*, `code`,
 * [words](url) and [[slug|words]] wiki links.
 */
type Inline = string | { b: Inline[] } | { i: Inline[] } | { code: string } | { href: string; text: Inline[]; wiki?: boolean }

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g

function inline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push({ b: inline(m[1]) })
    else if (m[2] !== undefined) out.push({ i: inline(m[2]) })
    else if (m[3] !== undefined) out.push({ code: m[3] })
    else if (m[4] !== undefined) out.push({ href: `/help/${m[4]}`, text: inline(m[5] ?? m[4]), wiki: true })
    else if (m[6] !== undefined) out.push({ href: m[7]!, text: inline(m[6]) })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Only our own pages, mailto: and https: links; anything else is shown as plain text. */
const safeHref = (h: string) => /^(\/(?!\/)|https:\/\/|mailto:)/.test(h)

function Inl({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, k) => {
    if (typeof p === 'string') return p
    if ('b' in p) return <strong key={k}><Inl parts={p.b} /></strong>
    if ('i' in p) return <em key={k}><Inl parts={p.i} /></em>
    if ('code' in p) return <code key={k} className="px-1 py-0.5 rounded bg-slate-800 text-slate-200 text-[0.9em]">{p.code}</code>
    if (!safeHref(p.href)) return <Inl key={k} parts={p.text} />
    const external = p.href.startsWith('https://')
    return <a key={k} href={p.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}><Inl parts={p.text} /></a>
  })
}

type Block =
  | { t: 'h'; level: 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'list'; ordered: boolean; items: Array<{ text: string; children: Block[] }> }

function blocks(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let i = 0
  const isItem = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l)
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    const h = line.match(/^(#{2,3})\s+(.*)$/)
    if (h) { out.push({ t: 'h', level: h[1]!.length as 2 | 3, text: h[2]! }); i++; continue }
    if (line.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) q.push(lines[i++]!.replace(/^>\s?/, ''))
      out.push({ t: 'quote', text: q.join(' ') }); continue
    }
    if (isItem(line)) {
      // Collect the whole list (items + their indented children), then parse it.
      const chunk: string[] = []
      while (i < lines.length && (isItem(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) chunk.push(lines[i++]!)
      out.push(list(chunk)); continue
    }
    const p: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(#{2,3}\s|>)/.test(lines[i]!) && !isItem(lines[i]!)) p.push(lines[i++]!.trim())
    out.push({ t: 'p', text: p.join(' ') })
  }
  return out
}

function list(chunk: string[]): Block {
  const indent = chunk[0]!.match(/^\s*/)![0].length
  const ordered = /^\s*\d+\./.test(chunk[0]!)
  const items: Array<{ text: string; children: Block[] }> = []
  let sub: string[] = []
  const flush = () => { if (sub.length && items.length) items.at(-1)!.children.push(...blocks(sub.map(l => l.slice(indent + 2)).join('\n'))); sub = [] }
  for (const l of chunk) {
    const own = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (own && own[1]!.length === indent) { flush(); items.push({ text: own[3]!, children: [] }) }
    else sub.push(l)
  }
  flush()
  return { t: 'list', ordered, items }
}

function Blocks({ list: bs }: { list: Block[] }): ReactNode {
  return bs.map((b, k) => {
    switch (b.t) {
      case 'h': return b.level === 2
        ? <h2 key={k} className="text-lg font-semibold text-slate-50 pt-4"><Inl parts={inline(b.text)} /></h2>
        : <h3 key={k} className="text-base font-semibold text-slate-100 pt-2"><Inl parts={inline(b.text)} /></h3>
      case 'p': return <p key={k}><Inl parts={inline(b.text)} /></p>
      case 'quote': return (
        <aside key={k} className="border-l-4 border-indigo-500/60 bg-indigo-500/10 rounded-r-lg px-4 py-3 text-slate-200">
          <Inl parts={inline(b.text)} />
        </aside>
      )
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul'
        return (
          <L key={k} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1.5`}>
            {b.items.map((it, j) => <li key={j}><Inl parts={inline(it.text)} />{it.children.length > 0 && <div className="mt-1.5 space-y-1.5"><Blocks list={it.children} /></div>}</li>)}
          </L>
        )
      }
    }
  })
}

export default function Markdown({ source }: { source: string }) {
  return <Blocks list={blocks(source)} />
}
