import { useState } from 'react'
import { useServices } from '../../hooks/useServices'
import { ServiceSetupPanel } from './ServiceSetupPanel'

export function SetupTab() {
  const { data, isLoading } = useServices()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (!data) return null

  // Default to first service when none selected
  const activeId = selectedId ?? data.services[0]?.id ?? null
  const activeService = data.services.find((s) => s.id === activeId)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      {/* Service selector sidebar */}
      <aside className="card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-unknown px-2 py-2">
          Apps
        </h2>
        <nav className="flex flex-col gap-1" role="listbox" aria-label="Apps">
          {data.services.map((s) => (
            <button
              key={s.id}
              role="option"
              aria-selected={activeId === s.id}
              onClick={() => setSelectedId(s.id)}
              className={`flex items-center gap-3 px-3 py-2 rounded-btn text-left text-sm transition-fast ${
                activeId === s.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-unknown hover:bg-surface-2 hover:text-white'
              }`}
            >
              <span className="text-lg" aria-hidden="true">{s.icon}</span>
              <span className="truncate flex-1">{s.display_name}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Active service setup panel */}
      <section>
        {activeService ? (
          <ServiceSetupPanel key={activeService.id} service={activeService} />
        ) : (
          <div className="card p-6 text-center text-unknown">
            Select an app to configure.
          </div>
        )}
      </section>
    </div>
  )
}
