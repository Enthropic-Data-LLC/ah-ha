import { useMe } from './hooks/useMe'
import AuthPage from './pages/AuthPage'
import VerifyPage from './pages/VerifyPage'
import OnboardingPage from './pages/OnboardingPage'
import SpacesPage from './pages/SpacesPage'
import BoardPage from './pages/BoardPage'
import TrailPage from './pages/TrailPage'
import NotePage from './pages/NotePage'
import ListPage from './pages/ListPage'
import KeysPage from './pages/KeysPage'
import SearchPage from './pages/SearchPage'

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useMe()
  const path = window.location.pathname
  const navLink = (href: string, label: string) => (
    <a
      href={href}
      className={`text-sm transition ${path === href || path.startsWith(href + '/') ? 'text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
    >
      {label}
    </a>
  )
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-slate-800 px-4 h-12 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-5">
          <a href="/spaces" className="font-bold text-sm tracking-tight">Ah-Ha</a>
          {user && (
            <>
              {navLink('/spaces', 'Spaces')}
              {navLink('/search', 'Search')}
            </>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            {navLink('/keys', 'API Keys')}
            <span className="text-xs text-slate-600">{user.username}</span>
          </div>
        )}
      </header>
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  const { user, isLoading, isLoggedOut } = useMe()

  // Public routes — no auth needed
  if (path === '/auth/verify' || path.startsWith('/auth/verify?')) {
    return <VerifyPage />
  }
  if (path === '/auth' || path === '/') {
    if (!isLoading && !isLoggedOut) {
      window.location.href = '/spaces'
      return null
    }
    return <AuthPage />
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Redirect to auth if logged out
  if (isLoggedOut) {
    window.location.href = '/auth'
    return null
  }

  // Onboarding
  if (path === '/onboarding' || (user && !user.username)) {
    return <OnboardingPage />
  }

  // Spaces list
  if (path === '/spaces') {
    return <Shell><SpacesPage /></Shell>
  }

  // Search
  if (path === '/search') {
    return <Shell><SearchPage /></Shell>
  }

  // API Keys
  if (path === '/keys') {
    return <Shell><KeysPage /></Shell>
  }

  // Space views: /spaces/:username/:type/:slug
  const spaceMatch = path.match(/^\/spaces\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (spaceMatch) {
    const [, , type, slug] = spaceMatch
    if (type === 'board') return <Shell><BoardPage slug={slug} /></Shell>
    if (type === 'trail') return <Shell><TrailPage slug={slug} /></Shell>
    if (type === 'note')  return <Shell><NotePage slug={slug} /></Shell>
    if (type === 'list')  return <Shell><ListPage slug={slug} /></Shell>
  }

  // Legacy redirect: /spaces/:type/:slug → /spaces/:username/:type/:slug
  const legacyMatch = path.match(/^\/spaces\/([^/]+)\/([^/]+)$/)
  if (legacyMatch && user?.username) {
    const [, type, slug] = legacyMatch
    window.location.replace(`/spaces/${user.username}/${type}/${slug}`)
    return null
  }

  // Fallback
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
      404 — <a href="/spaces" className="ml-1 underline hover:text-slate-300">Go home</a>
    </div>
  )
}
