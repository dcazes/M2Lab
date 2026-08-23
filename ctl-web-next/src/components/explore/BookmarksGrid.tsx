import { bookmarks } from '../../data/bookmarks'
import { ExternalLink } from 'lucide-react'

interface Bookmark {
  name: string
  url: string
  icon?: string
}

interface BookmarksGridProps {
  items?: Bookmark[]
}

export function BookmarksGrid({ items = bookmarks }: BookmarksGridProps) {
  return (
    <section className="card p-4">
      <h3 className="font-medium mb-4">Bookmarks</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((bookmark, index) => (
          <a
            key={index}
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-3 bg-surface-2 rounded-btn hover:bg-surface-1 transition-fast group"
          >
            {bookmark.icon ? (
              <span className="text-xl">{bookmark.icon}</span>
            ) : (
              <ExternalLink className="h-5 w-5 text-unknown group-hover:text-white transition-fast" />
            )}
            <span className="text-sm font-medium truncate">{bookmark.name}</span>
          </a>
        ))}
      </div>
    </section>
  )
}