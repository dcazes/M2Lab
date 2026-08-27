import { useClock } from '../../hooks/useClock'
import { useWeather } from '../../hooks/useWeather'
import { getWeatherIcon, getWeatherDescription } from '../../hooks/useWeather'

export function HeaderBar() {
  const time = useClock()
  const { weather, error: weatherError, loading: weatherLoading } = useWeather()

  const timeString = time.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const dateString = time.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface-1/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="brand-mark">M</div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight leading-tight">M2Lab</h1>
            <p className="hidden md:block text-[11px] text-unknown">Your private AI app platform</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono-tabular text-unknown bg-surface-2 rounded-btn">
            {dateString}
          </span>
        </div>

        <div className="flex-1 max-w-md mx-4" />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-sm font-mono-tabular">
            <span className="text-unknown">{timeString}</span>
          </div>

          <div className="flex items-center gap-2">
            {weatherLoading ? (
              <div className="flex items-center gap-2 text-sm text-unknown">
                <span className="animate-pulse">☁️</span>
                <span>Loading…</span>
              </div>
            ) : weatherError ? (
              <div className="flex items-center gap-2 text-sm text-warn">
                <span>⚠️</span>
                <span>Weather unavailable</span>
              </div>
            ) : weather ? (
              <div className="flex items-center gap-2 text-sm" title={getWeatherDescription(weather.weatherCode)}>
                <span className="text-lg">{getWeatherIcon(weather.weatherCode, weather.isDay)}</span>
                <span className="font-mono-tabular">{Math.round(weather.temperature)}°C</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
