import { BookmarksGrid } from './BookmarksGrid'
import { SearchBar } from './SearchBar'
import { WeatherWidget } from './WeatherWidget'

export function ExploreTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <SearchBar />
        <BookmarksGrid />
      </div>
      <div className="space-y-6">
        <WeatherWidget />
      </div>
    </div>
  )
}