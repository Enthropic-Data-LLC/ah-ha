const FEATURES = [
  {
    icon: '🗂️',
    name: 'Board',
    desc: 'Kanban-style cards with drag-and-drop columns. Track tasks, ideas, or anything with a status.',
  },
  {
    icon: '📍',
    name: 'Trail',
    desc: 'An append-only log with tamper-evident hash chain. Perfect for sensor data, journals, or audit trails.',
  },
  {
    icon: '📝',
    name: 'Note',
    desc: 'A freeform markdown document. Write once, link everywhere, search instantly.',
  },
  {
    icon: '✅',
    name: 'List',
    desc: 'A simple checklist. Add items, check them off, reorder at will.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 h-14 flex items-center justify-between">
        <span className="font-bold tracking-tight">aH-Ha</span>
        <a
          href="/auth"
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          Sign in
        </a>
      </header>

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="flex flex-col items-center justify-center text-center px-6 py-24 gap-6">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Your personal knowledge space
          </h1>
          <p className="text-slate-400 text-lg max-w-xl">
            Boards, trails, notes, and lists — all in one place, accessible via UI, REST API, or MCP.
          </p>
          <a
            href="/auth"
            className="mt-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-xl transition"
          >
            Get started free
          </a>
        </section>

        {/* Features */}
        <section className="max-w-4xl mx-auto w-full px-6 pb-24 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <div key={f.name} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{f.icon}</span>
                <h3 className="font-semibold">{f.name}</h3>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-slate-800 px-6 py-4 text-center text-xs text-slate-600">
        aH-Ha — open core personal knowledge platform
      </footer>
    </div>
  )
}
