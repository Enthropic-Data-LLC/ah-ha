import type { ReactNode } from 'react'

/**
 * Android downloads + sideload instructions. Shown on the landing page and at /android
 * (the landing page redirects signed-in users to /now, so they need their own route).
 *
 * The APKs are served by the Linode edge from /var/www/ah-ha.app/download/, not by the app:
 * a 30 MB file has no business crossing the WireGuard tunnel on every download.
 * Update APPS below whenever a new APK is published there.
 */
export interface AndroidApp {
  id: string
  name: string
  blurb: ReactNode
  url: string
  version: string
  sizeMb: number
  sha256: string
  minAndroid: string
  beta: boolean
}

export const APPS: AndroidApp[] = [
  {
    id: 'ah-ha',
    name: 'Ah-Ha for Android',
    blurb: <>Ah! Today, home-screen widget, reminders, NFC tags and QR codes, automatic check-ins, and instant alerts from your trackers. Works offline and syncs when you&apos;re back.</>,
    url: '/download/ah-ha.apk',
    version: '0.5.0',
    sizeMb: 28.7,
    sha256: 'eb62c1b8efa8f9053fe5f025415ad51d72b0599ff0cc4106a91a67137f02f5a4',
    minAndroid: '10',
    beta: true,
  },
  {
    id: 'ah-rhythm',
    name: 'Ah! Rhythm',
    blurb: (
      <>
        Your daily rhythm: supplements and meds, walks and workouts, eating windows, and holds (not eating till 10,
        no snacks, no social) with gentle “still holding?” check-ins. Grouped by Wake-up, Breakfast,
        Midday, Dinner and Bedtime, so one tap (or one NFC tag) checks off a whole group. Works on its own; connect it
        to Ah-Ha to log to your trail and show it on Today.
      </>
    ),
    url: '/download/ah-rhythm.apk',
    version: '0.3.0',
    sizeMb: 28.1,
    sha256: '52bcd522c3f52783aa3b0f058a964f04e73764bca4bdeb6b136ab9f2e3fb8e81',
    minAndroid: '10',
    beta: true,
  },
  {
    id: 'ah-cart',
    name: 'Ah! Cart',
    blurb: (
      <>
        Shop on the cash in your pocket: a running total with sales tax as things go in the cart, so you know before
        the register. Works on its own; connect it to Ah-Ha to shop from your list, with the store picked from where you are.
      </>
    ),
    url: '/download/ah-cart.apk',
    version: '0.2.0',
    sizeMb: 30.8,
    sha256: '616e5fcacf2e752bcd5bf265407cebceeebed0750df5b6d6a3ddaf7d264447b0',
    minAndroid: '10',
    beta: true,
  },
]

/** Kept for anything still reading the single-app shape. */
export const ANDROID = APPS[0]!

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Download the app',
    body: <>On your Android phone, tap <strong>Download for Android</strong>. Chrome may warn that this type of file can harm your device: tap <strong>Download anyway</strong>.</>,
  },
  {
    title: 'Allow installs from your browser',
    body: (
      <>
        Open the downloaded file. Android will say your phone is not allowed to install unknown apps from this source.
        Tap <strong>Settings</strong>, turn on <strong>Allow from this source</strong>, then go back.
        <span className="block mt-1 text-slate-400">
          Or set it ahead of time: Settings → Apps → Special app access → Install unknown apps → Chrome (or your browser) → Allow from this source.
        </span>
      </>
    ),
  },
  {
    title: 'Install',
    body: <>Tap <strong>Install</strong>. If Google Play Protect says it doesn&apos;t recognise the developer, tap <strong>More details</strong> → <strong>Install anyway</strong>. These apps aren&apos;t on the Play Store yet, so Play Protect has never seen them.</>,
  },
  {
    title: 'Connect it to your account',
    body: (
      <>
        Ah-Ha: sign in at ah-ha.app, open <a href="/keys" className="text-indigo-300 underline underline-offset-4 hover:text-indigo-200">Keys</a>, create a key named after your phone and copy it, then paste it into the app.
        <span className="block mt-1 text-slate-400">Ah! Rhythm and Ah! Cart: tap <strong>Connect</strong> in the app's settings (optional; both work on their own).</span>
      </>
    ),
  },
  {
    title: 'Turn the permission back off (optional)',
    body: <>Once the app is installed you can switch <strong>Allow from this source</strong> off again. You only need it on when you install an update.</>,
  },
]

function BetaBadge() {
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5 align-middle">
      Beta
    </span>
  )
}

function AppCard({ app, H }: { app: AndroidApp; H: 'h1' | 'h2' | 'h3' }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <H id={`${app.id}-heading`} className="text-lg font-semibold text-slate-100 flex items-center gap-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {app.name} {app.beta && <BetaBadge />}
          </H>
          <p className="text-slate-300 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>{app.blurb}</p>
        </div>
        <a
          href={app.url}
          download
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition shrink-0"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
          aria-label={`Download ${app.name}${app.beta ? ' (beta)' : ''} for Android`}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
            <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z" />
          </svg>
          Download
        </a>
      </div>
      <p className="text-xs text-slate-400 font-mono">
        Version {app.version}{app.beta && ' beta'}
        {app.sizeMb > 0 && <> · {app.sizeMb} MB</>}
        {' '}· Android {app.minAndroid} or newer · not on the Play Store yet
      </p>
      {app.sha256 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer hover:text-slate-200 py-1">Check the download (SHA-256)</summary>
          <code className="block mt-2 break-all font-mono text-slate-300 bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
            {app.sha256}
          </code>
        </details>
      )}
    </div>
  )
}

export default function AndroidInstall({ headingLevel = 2 }: { headingLevel?: 1 | 2 }) {
  const H = headingLevel === 1 ? 'h1' : 'h2'
  const Sub = headingLevel === 1 ? 'h2' : 'h3'
  return (
    <section id="android" aria-labelledby="android-heading" className="max-w-4xl mx-auto w-full px-6 pb-16 scroll-mt-20">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:p-8 space-y-6">
        <div className="space-y-1">
          <H id="android-heading" className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Android apps
          </H>
          <p className="text-sm text-amber-200/90" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            All three apps are in beta: they work and we use them daily, but they are still changing and you may hit rough edges.
            Don&apos;t make Ah! Rhythm your only reminder for a prescription medicine.
          </p>
        </div>

        <div className="space-y-4">
          {APPS.map(app => <AppCard key={app.id} app={app} H={Sub} />)}
        </div>

        <ol className="space-y-4" aria-label="How to install">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="w-7 h-7 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-mono flex items-center justify-center shrink-0" aria-hidden="true">
                {i + 1}
              </span>
              <div className="space-y-1 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                <h3 className="font-semibold text-slate-100">{s.title}</h3>
                <p className="text-slate-300 leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
