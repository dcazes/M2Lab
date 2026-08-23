import { Monitor, Server, Compass } from 'lucide-react'

interface TabNavProps {
  activeTab: 'services' | 'system' | 'explore'
  onChange: (tab: 'services' | 'system' | 'explore') => void
}

const tabs = [
  { id: 'services' as const, label: 'Services', icon: Monitor },
  { id: 'system' as const, label: 'System', icon: Server },
  { id: 'explore' as const, label: 'Explore', icon: Compass },
] as const

export function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <nav className="flex gap-1 bg-surface-1 rounded-card p-1 border border-border" role="tablist" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium transition-fast ${
            activeTab === id
              ? 'bg-surface-2 text-white shadow-sm'
              : 'text-unknown hover:text-white hover:bg-surface-2'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  )
}