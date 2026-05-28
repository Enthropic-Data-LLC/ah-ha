import { useMe } from './hooks/useMe'
import AuthPage from './pages/AuthPage'
import VerifyPage from './pages/VerifyPage'
import OnboardingPage from './pages/OnboardingPage'
import SpacesPage from './pages/SpacesPage'
import BoardPage from './pages/BoardPage'
import TrailPage from './pages/TrailPage'
import NotePage from './pages/NotePage'
import ListPage from './pages/ListPage'

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useMe()
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-slate-800 px-4 h-12 flex items-center justify-between flex-shrink-0">
        <a href="/spaces" className="font-bold text-sm tracking-tight">Ah-Ha</a>
        {user && (
          <div className="flex items-center gap-3">
            <a href="/spaces" className="text-sm text-slate-400 hover:text-slate-200 transition">Spaces</a>
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

  // Space views: /spaces/:type/:slug
  const spaceMatch = path.match(/^\/spaces\/([^/]+)\/([^/]+)$/)
  if (spaceMatch) {
    const [, type, slug] = spaceMatch
    if (type === 'board') return <Shell><BoardPage slug={slug} /></Shell>
    if (type === 'trail') return <Shell><TrailPage slug={slug} /></Shell>
    if (type === 'note')  return <Shell><NotePage slug={slug} /></Shell>
    if (type === 'list')  return <Shell><ListPage slug={slug} /></Shell>
  }

  // Fallback
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
      404 — <a href="/spaces" className="ml-1 underline hover:text-slate-300">Go home</a>
    </div>
  )
}
