const GH = 'https://github.com/Enthropic-Data-LLC/ah-ha'

const LINKS = [
  { href: '/android', label: 'Android app' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/accessibility', label: 'Accessibility' },
]

/** Footer for the public pages: the legal links live here so every public page carries them. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-800/60 px-6 py-5 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs text-slate-400">
      <span>aH-Ha · Enthropic Data LLC</span>
      <nav aria-label="Site" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {LINKS.map(l => (
          <a key={l.href} href={l.href} className="hover:text-slate-200 underline-offset-4 hover:underline py-1">
            {l.label}
          </a>
        ))}
        <a href={GH} target="_blank" rel="noreferrer" className="hover:text-slate-200 underline-offset-4 hover:underline py-1">
          Source
        </a>
      </nav>
    </footer>
  )
}
