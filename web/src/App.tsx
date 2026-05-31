import { useMe } from './hooks/useMe'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import VerifyPage from './pages/VerifyPage'
import OnboardingPage from './pages/OnboardingPage'
import SpacesPage from './pages/SpacesPage'
import BoardPage from './pages/BoardPage'
import TrailPage from './pages/TrailPage'
import NotePage from './pages/NotePage'
import ListPage from './pages/ListPage'
import TablePage from './pages/TablePage'
import KeysPage from './pages/KeysPage'
import SearchPage from './pages/SearchPage'
import AuditPage from './pages/AuditPage'
import MqttPage from './pages/MqttPage'
import WebhooksPage from './pages/WebhooksPage'
import CalendarPage from './pages/CalendarPage'
import NotificationsPage from './pages/NotificationsPage'
import SharePage from './pages/SharePage'
import NowPage from './pages/NowPage'
import EntityPage from './pages/EntityPage'

// SVG icons for bottom nav
const Icons = {
  now: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  spaces: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useMe()
  const path = window.location.pathname

  const isActive = (href: string) => path === href || path.startsWith(href + '/')

  // Desktop text nav link
  const navLink = (href: string, label: string) => (
    <a href={href} className={`text-sm transition hidden sm:block ${isActive(href) ? 'text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}>
      {label}
    </a>
  )

  // Mobile bottom tab
  const tabLink = (href: string, icon: React.ReactNode, label: string) => (
    <a href={href} className={`flex flex-col items-center gap-0.5 px-3 py-1 transition ${isActive(href) ? 'text-indigo-400' : 'text-slate-600'}`}>
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </a>
  )

  const spacesHref  = user ? `/${user.username}/spaces`   : '/auth'
  const entitiesHref = user ? `/${user.username}/entities` : '/auth'

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <header className="border-b border-slate-800 px-4 h-12 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <a href={spacesHref} className="font-bold text-sm tracking-tight">aH-Ha</a>
          {user && (
            <>
              <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full hidden sm:inline">@{user.username}</span>
              {navLink('/now', 'Now')}
              {navLink(spacesHref, 'Spaces')}
              {navLink(entitiesHref, 'Entities')}
              {navLink('/search', 'Search')}
              {navLink('/audit', 'Audit')}
            </>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            {navLink('/keys', 'API Keys')}
            {navLink('/calendar', 'Calendar')}
            {navLink('/settings', 'Settings')}
          </div>
        )}
      </header>

      {/* Main content — add bottom padding on mobile to clear the tab bar */}
      <main className="flex-1 flex flex-col overflow-hidden pb-16 sm:pb-0">{children}</main>

      {/* Mobile bottom tab bar — hidden on sm+ */}
      {user && (
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 h-16 bg-slate-950 border-t border-slate-800 flex items-center justify-around px-2 z-40">
          {tabLink('/now', Icons.now, 'Now')}
          {tabLink(spacesHref, Icons.spaces, 'Spaces')}
          {tabLink('/search', Icons.search, 'Search')}
          {tabLink('/settings', Icons.settings, 'Settings')}
        </nav>
      )}
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  const { user, isLoading, isLoggedOut } = useMe()

  // Public routes — no auth needed
  // Public share link
  const shareMatch = path.match(/^\/s\/([A-Za-z0-9_-]{24})$/)
  if (shareMatch) {
    return <SharePage token={shareMatch[1]!} />
  }

  if (path === '/auth/verify' || path.startsWith('/auth/verify?')) {
    return <VerifyPage />
  }
  if (path === '/') {
    if (!isLoading && user?.username) {
      window.location.replace(`/${user.username}/spaces`)
      return null
    }
    return <LandingPage />
  }
  if (path === '/auth') {
    if (!isLoading && user?.username) {
      window.location.replace(`/${user.username}/spaces`)
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

  // /spaces → redirect to /:username/spaces
  if (path === '/spaces') {
    if (user?.username) { window.location.replace(`/${user.username}/spaces`); return null }
    return <Shell><SpacesPage /></Shell>
  }

  // Search
  if (path === '/search') {
    return <Shell><SearchPage /></Shell>
  }

  // Now view
  if (path === '/now') {
    return <Shell><NowPage /></Shell>
  }

  // /:username/entities
  const entitiesMatch = path.match(/^\/([^/]+)\/entities$/)
  if (entitiesMatch) {
    return <Shell><EntityPage /></Shell>
  }

  // MQTT subscriptions
  if (path === '/mqtt') {
    return <Shell><MqttPage /></Shell>
  }

  // Webhooks
  if (path === '/webhooks') {
    return <Shell><WebhooksPage /></Shell>
  }

  // Calendar sources
  if (path === '/calendar') {
    return <Shell><CalendarPage /></Shell>
  }

  // Notification settings
  if (path === '/settings') {
    return <Shell><NotificationsPage /></Shell>
  }

  // Audit Log
  if (path === '/audit') {
    return <Shell><AuditPage /></Shell>
  }

  // API Keys
  if (path === '/keys') {
    return <Shell><KeysPage /></Shell>
  }

  // /:username — redirect to /:username/spaces
  const userHomeMatch = path.match(/^\/([^/]+)$/)
  if (userHomeMatch) {
    window.location.replace(`/${userHomeMatch[1]}/spaces`)
    return null
  }

  // /:username/spaces — spaces list
  const spacesHomeMatch = path.match(/^\/([^/]+)\/spaces$/)
  if (spacesHomeMatch) {
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
    if (type === 'table') return <Shell><TablePage slug={slug} /></Shell>
  }

  // Legacy redirect: /spaces/:username/:type/:slug → /:username/spaces/:type/:slug
  const legacyMatch = path.match(/^\/spaces\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (legacyMatch) {
    const [, username, type, slug] = legacyMatch
    window.location.replace(`/${username}/spaces/${type}/${slug}`)
    return null
  }

  // Fallback
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
      404 — <a href="/" className="ml-1 underline hover:text-slate-300">Go home</a>
    </div>
  )
}
