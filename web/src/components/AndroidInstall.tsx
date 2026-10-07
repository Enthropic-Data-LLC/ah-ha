import type { ReactNode } from 'react'

/**
 * Android download + sideload instructions. Shown on the landing page and at /android
 * (the landing page redirects signed-in users to /now, so they need their own route).
 *
 * The APK is served by the Linode edge from /var/www/ah-ha.app/download/, not by the app:
 * a 40 MB file has no business crossing the WireGuard tunnel on every download.
 * Update ANDROID below whenever a new APK is published there.
 */
export const ANDROID = {
  url: '/download/ah-ha.apk',
  version: '0.2.0',
  sizeMb: 0,
  sha256: '',
  minAndroid: '10',
}

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
    body: <>Tap <strong>Install</strong>. If Google Play Protect says it doesn&apos;t recognise the developer, tap <strong>More details</strong> → <strong>Install anyway</strong>. Ah-Ha isn&apos;t on the Play Store yet, so Play Protect has never seen it.</>,
  },
  {
    title: 'Connect it to your account',
    body: <>Sign in at ah-ha.app, open <a href="/keys" className="text-indigo-300 underline underline-offset-4 hover:text-indigo-200">Keys</a>, create a key named after your phone and copy it. Open Ah-Ha on the phone and paste the key.</>,
  },
  {
    title: 'Turn the permission back off (optional)',
    body: <>Once Ah-Ha is installed you can switch <strong>Allow from this source</strong> off again. You only need it on when you install an update.</>,
  },
]

export default function AndroidInstall({ headingLevel = 2 }: { headingLevel?: 1 | 2 }) {
  const H = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section id="android" aria-labelledby="android-heading" className="max-w-4xl mx-auto w-full px-6 pb-16 scroll-mt-20">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <H id="android-heading" className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Ah-Ha for Android
            </H>
            <p className="text-slate-300 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Today screen, home-screen widget, reminders, NFC tags and automatic check-ins. Works offline and syncs when you&apos;re back.
            </p>
          </div>
          <a
            href={ANDROID.url}
            download
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition shrink-0"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
              <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z" />
            </svg>
            Download for Android
          </a>
        </div>

        <p className="text-xs text-slate-400 font-mono">
          Version {ANDROID.version}
          {ANDROID.sizeMb > 0 && <> · {ANDROID.sizeMb} MB</>}
          {' '}· Android {ANDROID.minAndroid} or newer · not on the Play Store yet
        </p>

        <ol className="space-y-4">
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

        {ANDROID.sha256 && (
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-200 py-1">Check the download (SHA-256)</summary>
            <code className="block mt-2 break-all font-mono text-slate-300 bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
              {ANDROID.sha256}
            </code>
          </details>
        )}
      </div>
    </section>
  )
}
