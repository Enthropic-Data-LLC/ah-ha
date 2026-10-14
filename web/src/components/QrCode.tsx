import qrcode from 'qrcode-generator'

/** The dark modules of a QR code for [value], level M (survives a scuffed sticker). */
export function qrModules(value: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/**
 * A QR code drawn as SVG (no HTML strings). Always black on white with a quiet zone, so it
 * scans in dark mode and on paper.
 */
export default function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const m = qrModules(value), n = m.length, q = 4
  const d = m.flatMap((row, r) => row.map((on, c) => (on ? `M${c + q} ${r + q}h1v1h-1z` : ''))).join('')
  return (
    <svg viewBox={`0 0 ${n + 2 * q} ${n + 2 * q}`} width={size} height={size} role="img" aria-label={label}
      shapeRendering="crispEdges" className="bg-white rounded">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

/** Download the code as a PNG ([px] wide), e.g. to print on a label maker. */
export function downloadQrPng(value: string, fileName: string, px = 1024) {
  const m = qrModules(value), n = m.length, q = 4, cell = Math.floor(px / (n + 2 * q))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = cell * (n + 2 * q)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  m.forEach((row, r) => row.forEach((on, c) => { if (on) ctx.fillRect((c + q) * cell, (r + q) * cell, cell, cell) }))
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${fileName.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'tag'}-qr.png`
  a.click()
}
