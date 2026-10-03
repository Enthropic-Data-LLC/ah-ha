/** First focusable element on every layout: lets keyboard users jump past the nav (WCAG 2.4.1). */
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white focus:text-sm"
    >
      Skip to main content
    </a>
  )
}
