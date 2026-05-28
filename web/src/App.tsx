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
          <a href={user ? `/${user.username}` : '/auth'} className="font-bold text-sm tracking-tight">Ah-Ha</a>
          {user && (
            <>
              {navLink(`/${user.username}`, 'Spaces')}
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
      window.location.href = user?.username ? `/${user.username}` : '/spaces'
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

  // /spaces → redirect to /:username
  if (path === '/spaces') {
    if (user?.username) { window.location.replace(`/${user.username}`); return null }
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

  // /:username — spaces list (user home)
  const userHomeMatch = path.match(/^\/([^/]+)$/)
  if (userHomeMatch) {
    return <Shell><SpacesPage /></Shell>
  }

  // /:username/spaces/:type/:slug — space detail
  const spaceMatch = path.match(/^\/([^/]+)\/spaces\/([^/]+)\/([^/]+)$/)
  if (spaceMatch) {
    const [, , type, slug] = spaceMatch
    if (type === 'board') return <Shell><BoardPage slug={slug} /></Shell>
    if (type === 'trail') return <Shell><TrailPage slug={slug} /></Shell>
    if (type === 'note')  return <Shell><NotePage slug={slug} /></Shell>
    if (type === 'list')  return <Shell><ListPage slug={slug} /></Shell>
  }

  // Legacy redirect: /spaces/:username/:type/:slug → /:username/spaces/:type/:slug
  const legacyMatch = path.match(/^\/spaces\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (legacyMatch) {
    const [, username, type, slug] = legacyMatch
    window.location.replace(`/${username}/spaces/${type}/${slug}`)
    return null
  }
  // Legacy redirect: /:username/spaces → /:username
  const spacesHomeMatch = path.match(/^\/([^/]+)\/spaces$/)
  if (spacesHomeMatch) {
    window.location.replace(`/${spacesHomeMatch[1]}`)
    return null
  }

  // Fallback
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
      404 — <a href="/spaces" className="ml-1 underline hover:text-slate-300">Go home</a>
    </div>
  )
}
