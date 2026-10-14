import useSWR from 'swr'
import { useEffect } from 'react'
import { fetcher } from '../lib/api'
import QrCode from '../components/QrCode'
import type { Tag } from './TagsPage'

/**
 * /tags/print?ids=a,b — a plain white sheet of QR labels, outside the app shell, that
 * opens the print dialog once the codes are drawn. Each label: code, icon + name, a hint.
 */
export default function TagsPrintPage() {
  const ids = new URLSearchParams(window.location.search).get('ids')?.split(',').filter(Boolean) ?? []
  const { data } = useSWR<{ data: Tag[] }>('/api/nfc/tags', fetcher)
  const tags = (data?.data ?? []).filter(t => ids.includes(t.tag_id))
  useEffect(() => {
    document.title = 'Print tags · Ah-Ha'
    if (tags.length) { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t) }
  }, [tags.length])

  return (
    <div className="min-h-screen bg-white text-black p-8 print:p-0">
      <div className="print:hidden mb-6 flex items-center gap-3 text-sm">
        <button onClick={() => window.print()} className="px-4 py-2 bg-black text-white rounded-lg">Print</button>
        <a href="/tags" className="underline">Back to tags</a>
        <span className="text-gray-600">Tip: print on sticker paper, or print and tape it up. Keep codes at least 3 cm (1¼ in) wide.</span>
      </div>
      {data && !tags.length && <p>No tags to print. Choose them on the <a href="/tags" className="underline">Tags</a> page.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 print:gap-4">
        {tags.map(t => (
          <figure key={t.tag_id} className="border border-gray-300 rounded-xl p-4 flex flex-col items-center text-center break-inside-avoid">
            <QrCode value={t.url} size={180} label={`QR code for ${t.name}`} />
            <figcaption className="mt-2 space-y-0.5">
              <p className="text-lg font-semibold">{t.icon} {t.name}</p>
              <p className="text-xs text-gray-600">Scan with your phone camera · Ah-Ha</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
