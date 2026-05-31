const SPACES = [
  {
    name: 'Trail',
    tag: 'hash-chained log',
    desc: 'Append-only, tamper-evident entries with cryptographic integrity. Sensor data, health metrics, journals — anything that must never be altered.',
    accent: 'text-emerald-400',
    border: 'border-emerald-900/60',
    bg: 'bg-emerald-950/20',
  },
  {
    name: 'Board',
    tag: 'kanban',
    desc: 'Ranked cards across custom columns. Full drag-and-drop. AI agents can move cards and create new ones without any explanation of your structure.',
    accent: 'text-indigo-400',
    border: 'border-indigo-900/60',
    bg: 'bg-indigo-950/20',
  },
  {
    name: 'Note',
    tag: 'freeform doc',
    desc: 'A document that lives in your knowledge graph. Write in it yourself or let an agent fill it with research. Searchable across all your spaces.',
    accent: 'text-amber-400',
    border: 'border-amber-900/60',
    bg: 'bg-amber-950/20',
  },
  {
    name: 'List',
    tag: 'checklist',
    desc: 'Simple, ordered items. Check things off, reorder freely. Agents can add items from triggers — a webhook fires, a new item appears.',
    accent: 'text-sky-400',
    border: 'border-sky-900/60',
    bg: 'bg-sky-950/20',
  },
  {
    name: 'Table',
    tag: 'structured rows',
    desc: 'Typed columns, flexible schema. Feed rows in via API, MQTT, or webhook. Query with filters. The spreadsheet that talks to your automations.',
    accent: 'text-violet-400',
    border: 'border-violet-900/60',
    bg: 'bg-violet-950/20',
  },
]

const INTEGRATIONS = [
  {
    name: 'MCP Server',
    desc: 'Claude and any MCP-compatible agent can read, write, search, and reason over your spaces natively — no prompting required.',
    code: 'npx @enthropicdata/ah-ha-mcp-server',
  },
  {
    name: 'REST API',
    desc: 'Every space type has a full CRUD API. Generate an API key and pipe data in from any language, shell script, or automation.',
    code: 'POST /api/trail/:slug/append',
  },
  {
    name: 'MQTT Bridge',
    desc: 'Subscribe topics directly to Trail spaces. IoT sensors, home automation events, and telemetry write themselves into hash-chained logs.',
    code: 'topic: home/sensors/+/temp',
  },
  {
    name: 'Webhooks',
    desc: 'Register an endpoint. Any system that can POST JSON can create cards, append trail entries, or add list items — no credentials needed.',
    code: 'POST /api/webhooks/receive/:id',
  },
]

const GH = 'https://github.com/Enthropic-Data-LLC/ah-ha'

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100" style={{ fontFamily: "'DM Mono', 'Fira Code', 'Cascadia Code', monospace" }}>

      {/* Nav */}
      <header className="border-b border-slate-800/60 px-6 h-14 flex items-center justify-between sticky top-0 bg-slate-950/90 backdrop-blur z-10">
        <span className="font-bold tracking-tight text-slate-100">aH-Ha</span>
        <div className="flex items-center gap-3">
          <a
            href={GH}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-600 rounded-lg transition"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
          <a
            href="/auth"
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-lg transition"
          >
            Sign in
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col">

        {/* Hero */}
        <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 gap-8 relative overflow-hidden">
          {/* Subtle grid background */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: 'linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />

          <div className="relative space-y-6 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-800/60 bg-indigo-950/40 text-xs text-indigo-400 font-mono">
              open source · self-hostable · MCP-native
            </div>

            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight text-slate-50" style={{ fontFamily: "'DM Sans', 'Outfit', sans-serif", letterSpacing: '-0.03em' }}>
              Not a task manager.<br />
              <span className="text-indigo-400">A programmable</span><br />
              personal data layer.
            </h1>

            <p className="text-slate-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Most knowledge tools were built for humans to read back later.
              aH-Ha is built for humans <em>and AI agents</em> to work with right now —
              via UI, REST API, MQTT, webhooks, or MCP.
            </p>

            <div className="flex items-center justify-center gap-3 pt-2">
              <a
                href="/auth"
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Get started free
              </a>
              <a
                href={GH}
                target="_blank"
                rel="noreferrer"
                className="px-6 py-2.5 border border-slate-700 hover:border-slate-500 text-sm text-slate-400 hover:text-slate-200 rounded-xl transition"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                View source
              </a>
            </div>
          </div>
        </section>

        {/* Trail callout — the flagship differentiator */}
        <section className="max-w-4xl mx-auto w-full px-6 pb-16">
          <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/10 p-6 sm:p-8 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-900/40 border border-emerald-800/60 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-emerald-400 text-lg font-mono">#</span>
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  Trail — the space type you've never seen before
                </h2>
                <p className="text-slate-400 text-sm leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  Every entry is cryptographically linked to the one before it. Tamper one record and the chain breaks.
                  Pipe in IoT sensor readings via MQTT, ingest home automation events via webhooks, or write your journal —
                  Trail stores it all as an immutable, queryable, AI-readable time-series log.
                </p>
                <div className="pt-1">
                  <code className="text-xs text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-900/40">
                    SHA-256 hash chain · TimescaleDB · tone analysis · streak detection
                  </code>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Space types grid */}
        <section className="max-w-4xl mx-auto w-full px-6 pb-16 space-y-4">
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase px-1">Five space types</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SPACES.map(s => (
              <div key={s.name} className={`rounded-2xl border ${s.border} ${s.bg} p-5 space-y-2`}>
                <div className="flex items-center justify-between">
                  <h3 className={`font-semibold ${s.accent}`} style={{ fontFamily: "'DM Sans', sans-serif" }}>{s.name}</h3>
                  <span className="text-xs text-slate-600 font-mono">{s.tag}</span>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Integrations / programmable angle */}
        <section className="max-w-4xl mx-auto w-full px-6 pb-16 space-y-4">
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase px-1">Programmable from day one</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {INTEGRATIONS.map(i => (
              <div key={i.name} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-2.5">
                <h3 className="font-semibold text-slate-200 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>{i.name}</h3>
                <p className="text-slate-400 text-xs leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>{i.desc}</p>
                <code className="block text-xs text-indigo-400 font-mono bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 truncate">
                  {i.code}
                </code>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="max-w-4xl mx-auto w-full px-6 pb-24">
          <div className="rounded-2xl border border-indigo-900/50 bg-indigo-950/10 p-8 text-center space-y-4">
            <h2 className="text-2xl font-bold text-slate-100" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
              Your data. Your automations. Your AI.
            </h2>
            <p className="text-slate-400 text-sm max-w-lg mx-auto" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Self-host in 5 minutes or use the hosted version. MIT licensed. No lock-in.
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              <a href="/auth" className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Create an account
              </a>
              <a href={GH} target="_blank" rel="noreferrer" className="px-6 py-2.5 border border-slate-700 hover:border-slate-500 text-sm text-slate-400 hover:text-slate-200 rounded-xl transition" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Self-host
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/60 px-6 py-5 flex items-center justify-between text-xs text-slate-600">
        <span>aH-Ha — open source personal knowledge platform</span>
        <a
          href={GH}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 hover:text-slate-400 transition"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Enthropic-Data-LLC/ah-ha
        </a>
      </footer>
    </div>
  )
}
