import { useWeather, getWeatherIcon, getWeatherDescription } from '../../hooks/useWeather'

export function WeatherWidget() {
  const { weather, error, loading } = useWeather()

  if (loading) {
    return (
      <section className="card p-4">
        <h3 className="font-medium mb-3">Weather</h3>
        <div className="flex items-center gap-3 text-unknown">
          <div className="animate-pulse h-12 w-12 rounded-lg bg-surface-2" />
          <div className="space-y-2">
            <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
            <div className="h-3 w-16 bg-surface-2 rounded animate-pulse" />
          </div>
        </div>
      </section>
    )
  }

  if (error || !weather) {
    return (
      <section className="card p-4">
        <h3 className="font-medium mb-3">Weather</h3>
        <div className="flex items-center gap-2 text-warn text-sm">
          <span>⚠️</span>
          <span>Weather unavailable</span>
        </div>
      </section>
    )
  }

  return (
    <section className="card p-4">
      <h3 className="font-medium mb-3">Weather</h3>
      <div className="flex items-center gap-4">
        <span className="text-4xl" title={getWeatherDescription(weather.weatherCode)}>
          {getWeatherIcon(weather.weatherCode, weather.isDay)}
        </span>
        <div>
          <p className="text-2xl font-mono-tabular font-medium">{Math.round(weather.temperature)}°C</p>
          <p className="text-sm text-unknown">{getWeatherDescription(weather.weatherCode)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-2 text-unknown">
          <span>💨</span>
          <span>{weather.windSpeed} km/h</span>
        </div>
        <div className="flex items-center gap-2 text-unknown">
          <span>💧</span>
          <span>{weather.humidity}%</span>
        </div>
      </div>
    </section>
  )
}