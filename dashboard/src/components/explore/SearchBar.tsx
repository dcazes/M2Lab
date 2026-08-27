import { Search } from 'lucide-react'

export function SearchBar() {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const query = formData.get('q') as string
    if (query.trim()) {
      window.open(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer')
      e.currentTarget.reset()
    }
  }

  return (
    <section className="card p-4">
      <form onSubmit={handleSubmit} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-unknown text-sm" aria-hidden="true" />
        <input
          type="search"
          name="q"
          placeholder="Search DuckDuckGo…"
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-2 border border-border rounded-btn placeholder-unknown focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-fast"
          autoComplete="off"
        />
      </form>
    </section>
  )
}