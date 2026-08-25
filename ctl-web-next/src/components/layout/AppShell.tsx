import { useState } from 'react'
import { HeaderBar } from './HeaderBar'
import { TabNav } from './TabNav'
import { ServicesTab } from '../services/ServicesTab'
import { SystemTab } from '../system/SystemTab'
import { SetupTab } from '../setup/SetupTab'

export type AppTab = 'workspace' | 'system' | 'settings'

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>('workspace')
  const [settingsServiceId, setSettingsServiceId] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<'apps' | 'models' | 'connections'>('apps')

  const openSettings = (serviceId: string) => {
    setSettingsServiceId(serviceId)
    setSettingsSection(serviceId === 'litellm' ? 'models' : 'apps')
    setActiveTab('settings')
  }

  return (
    <div className="min-h-screen bg-bg-base font-ui">
      <HeaderBar />
      <main className="mx-auto max-w-[1500px] p-4 md:p-6 lg:p-8">
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-6 animate-in fade-in duration-200">
          {activeTab === 'workspace' && <ServicesTab onOpenSettings={openSettings} />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'settings' && <SetupTab initialSelectedId={settingsServiceId} initialSection={settingsSection} />}
        </div>
      </main>
    </div>
  )
}
