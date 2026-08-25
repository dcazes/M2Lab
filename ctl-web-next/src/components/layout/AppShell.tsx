import { useState } from 'react'
import { HeaderBar } from './HeaderBar'
import { TabNav } from './TabNav'
import { ServicesTab } from '../services/ServicesTab'
import { SystemTab } from '../system/SystemTab'
import { ExploreTab } from '../explore/ExploreTab'
import { SetupTab } from '../setup/SetupTab'
import { CatalogTab } from '../catalog/CatalogTab'
import { InitiateTab } from '../initiate/InitiateTab'

export type AppTab = 'initiate' | 'discover' | 'workspace' | 'system' | 'settings' | 'explore'

const INITIATE_STORAGE_KEY = 'omnilab.initiate.v1'

function initialTab(): AppTab {
  try {
    const progress = JSON.parse(localStorage.getItem(INITIATE_STORAGE_KEY) || '{}')
    return progress.finished ? 'workspace' : 'initiate'
  } catch {
    return 'initiate'
  }
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab)
  const [settingsServiceId, setSettingsServiceId] = useState<string | null>(null)

  const openSettings = (serviceId: string) => {
    setSettingsServiceId(serviceId)
    setActiveTab('settings')
  }

  return (
    <div className="min-h-screen bg-bg-base font-ui">
      <HeaderBar />
      <main className="mx-auto max-w-[1500px] p-4 md:p-6 lg:p-8">
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-6 animate-in fade-in duration-200">
          {activeTab === 'initiate' && <InitiateTab onFinish={() => setActiveTab('workspace')} onOpenSettings={openSettings} />}
          {activeTab === 'discover' && <CatalogTab onOpenSettings={openSettings} onOpenWorkspace={() => setActiveTab('workspace')} />}
          {activeTab === 'workspace' && <ServicesTab />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'settings' && <SetupTab initialSelectedId={settingsServiceId} />}
          {activeTab === 'explore' && <ExploreTab />}
        </div>
      </main>
    </div>
  )
}
