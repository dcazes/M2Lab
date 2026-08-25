import { Grid2X2, Monitor, Server, Compass, Settings, WandSparkles } from 'lucide-react'
import type { AppTab } from './AppShell'

interface TabNavProps {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

const tabs = [
  { id: 'initiate' as const, label: 'Initiate', icon: WandSparkles },
  { id: 'workspace' as const, label: 'Workspace', icon: Monitor },
  { id: 'discover' as const, label: 'Catalog', icon: Grid2X2 },
  { id: 'system' as const, label: 'System', icon: Server },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
  { id: 'explore' as const, label: 'Explore', icon: Compass },
] as const

export function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <nav className="tab-strip flex gap-1 overflow-x-auto bg-surface-1/80 rounded-card p-1 border border-border shadow-[0_16px_60px_rgba(0,0,0,.18)]" role="tablist" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => onChange(id)}
          className={`whitespace-nowrap flex items-center gap-2 px-4 py-2.5 rounded-btn text-sm font-medium transition-fast ${
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
