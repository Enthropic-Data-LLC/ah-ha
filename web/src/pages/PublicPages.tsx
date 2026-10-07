import type { ReactNode } from 'react'
import SkipLink from '../components/SkipLink'
import SiteFooter from '../components/SiteFooter'
import AndroidInstall from '../components/AndroidInstall'

const CONTACT = 'dbrown@enthropicdata.com'
const UPDATED = '7 October 2026'

/** Shell for the public, signed-out pages: same header and footer as the landing page. */
function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <SkipLink />
      <header className="border-b border-slate-800/60 px-6 h-14 flex items-center justify-between">
        <a href="/" className="font-bold tracking-tight text-slate-100 py-2">aH-Ha</a>
        <a href="/auth" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-lg transition">
          Sign in
        </a>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 w-full pt-10 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PublicLayout>
      <article className="max-w-3xl mx-auto px-6 pb-16 space-y-6 text-sm leading-relaxed text-slate-300 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-100 [&_h2]:pt-4 [&_a]:text-indigo-300 [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-slate-100">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-50">{title}</h1>
          <p className="text-xs text-slate-400">Last updated {UPDATED}</p>
        </header>
        {children}
      </article>
    </PublicLayout>
  )
}

export function AndroidPage() {
  return (
    <PublicLayout>
      <AndroidInstall headingLevel={1} />
    </PublicLayout>
  )
}

export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy">
      <p>
        Ah-Ha (ah-ha.app) is run by Enthropic Data LLC. This page says what we collect, why, who else
        sees it, and how to get it changed or deleted. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and username. Sign-in is by emailed link; we never hold a password.</li>
        <li><strong>What you put in:</strong> boards, lists, notes, tables, trail entries, places, tags, links and settings. This is your content and we store it to show it back to you.</li>
        <li><strong>What you connect:</strong> anything sent in by an API key, webhook, MQTT feed, NFC tag or device you set up (for example a home router reporting who is home) is stored in your account like any other entry.</li>
        <li><strong>Location, only if you turn it on:</strong> the Android app can check you in when you arrive at a place you saved. The geofence runs on your phone; we receive the check-in (which place, and when) and the coordinates of places you save.</li>
        <li><strong>Calendars you add:</strong> we fetch the iCal links you give us to show upcoming events.</li>
        <li><strong>Sign-in session:</strong> one cookie, <code>aha_session</code>, which keeps you signed in for 30 days. It is required for the site to work. We set no advertising or tracking cookies.</li>
        <li><strong>Server logs:</strong> each request records the IP address, browser user agent, page requested and time. We use them to block attacks and for internal traffic counts.</li>
      </ul>

      <h2>Analytics</h2>
      <p>
        We do not use third-party analytics or tracking scripts. Visit and sign-up counts come from our own
        server logs and database. Nothing is shared with an analytics or advertising company.
      </p>

      <h2>Who else processes your data</h2>
      <ul>
        <li><strong>Email delivery</strong> (Resend, Maileroo): your email address and the sign-in link or notification we send you.</li>
        <li><strong>AI features</strong> (Anthropic): the daily briefing and smart capture send the items they summarise (for example task titles, upcoming events and your current place) to Anthropic&apos;s API. If you add your own Anthropic key in Settings, your key is used instead of ours.</li>
        <li><strong>Weather</strong> (Open-Meteo): coordinates rounded to about 1 km, with no account information attached.</li>
        <li><strong>Telegram</strong>, only if you turn on Telegram notifications: the notification text.</li>
        <li><strong>Hosting:</strong> our own servers and a Linode (Akamai) server in the United States.</li>
      </ul>
      <p>We do not sell or share personal information for advertising.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account data and content: for as long as you have an account. When you ask us to delete the account, it is removed within 30 days, and from backups when they rotate out (45 days).</li>
        <li>Server logs: 30 days on the servers. An internal archive of them is kept on our own machines for security investigations.</li>
        <li>Sign-in links expire after one use or 15 minutes.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your data, wherever you live. Most of it can be
        exported yourself through the API. For anything else, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from
        your account&apos;s address and we will answer within 30 days. We honour Global Privacy Control signals,
        though since we do not sell or share data there is nothing for them to switch off.
      </p>

      <h2>Children</h2>
      <p>Ah-Ha is not meant for children under 13, and we do not knowingly collect their data.</p>

      <h2>Security</h2>
      <p>
        All traffic is encrypted (HTTPS only). API keys are stored hashed. The trail is hash-chained so changes to
        past entries are detectable. No system is perfectly secure; if we learn of a breach that affects you, we will tell you.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, we will email account holders before it takes effect.</p>
    </Doc>
  )
}

export function TermsPage() {
  return (
    <Doc title="Terms of Service">
      <p>
        These terms cover your use of the hosted service at ah-ha.app, run by Enthropic Data LLC (&quot;we&quot;).
        By creating an account you agree to them. The Ah-Ha source code is separately available under the MIT
        licence; these terms apply only to the hosted service.
      </p>

      <h2>The service</h2>
      <p>
        Ah-Ha is in early access. Features change, and the service may be interrupted. It is provided &quot;as is&quot;,
        without warranties of any kind. Do not rely on it as the only place you keep something you cannot lose, or
        for anything safety-critical: reminders, medication logs and check-ins are aids, not alarms you can depend on.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You need a working email address. Keep access to it and to your API keys secure; you are responsible for what is done with them.</li>
        <li>You must be at least 13 years old.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You own what you put into Ah-Ha. You give us permission to store, process and display it only as needed to run
        the service for you, including sending it to the providers listed in the <a href="/privacy">Privacy Policy</a> when
        you use features that need them.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No illegal content, malware, or content that infringes someone else&apos;s rights.</li>
        <li>No attempts to break into, overload or scan the service, or to get at other people&apos;s data.</li>
        <li>Stay within the API rate limits; do not use automation to get around them.</li>
      </ul>
      <p>We may suspend accounts that break these rules.</p>

      <h2>Ending your account</h2>
      <p>
        You can stop using Ah-Ha at any time and ask us to delete your account. We may close accounts or end the service
        with 30 days&apos; notice by email, and will give you a way to export your data first.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses, or for lost data, and our
        total liability is limited to the amount you paid us in the 12 months before the claim (or US $50 if you paid nothing).
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of North Carolina, USA.</p>

      <h2>Changes and contact</h2>
      <p>
        We will email account holders before material changes take effect. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Doc>
  )
}

export function AccessibilityPage() {
  return (
    <Doc title="Accessibility Statement">
      <p>
        We want Ah-Ha to work for everyone, including people who use a keyboard, a screen reader, zoom or reduced motion.
        Our target is <strong>WCAG 2.2 level AA</strong>.
      </p>

      <h2>What we do</h2>
      <ul>
        <li>A &quot;Skip to main content&quot; link on every page and visible focus outlines for keyboard users.</li>
        <li>Page language set, landmarks (header, navigation, main, footer) and a logical heading order.</li>
        <li>Text contrast of at least 4.5:1 on the public pages.</li>
        <li>Animations and transitions are turned off when your device asks for reduced motion.</li>
      </ul>

      <h2>Known gaps</h2>
      <ul>
        <li>Some secondary text inside the signed-in app is still below 4.5:1 contrast.</li>
        <li>Board cards can be moved with the keyboard (focus a card, press Space to lift it, use the arrow keys, Space to drop), but this is not yet explained on the board itself.</li>
        <li>We have not yet run a full screen-reader test of every page.</li>
      </ul>

      <h2>Tell us</h2>
      <p>
        If something in Ah-Ha is hard or impossible for you to use, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        We aim to reply within 5 working days.
      </p>
    </Doc>
  )
}
