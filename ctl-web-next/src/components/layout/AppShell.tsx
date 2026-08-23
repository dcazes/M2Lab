import { useState } from 'react'
import { HeaderBar } from './HeaderBar'
import { TabNav } from './TabNav'
import { ServicesTab } from '../services/ServicesTab'
import { SystemTab } from '../system/SystemTab'
import { ExploreTab } from '../explore/ExploreTab'

export function AppShell() {
  const [activeTab, setActiveTab] = useState<'services' | 'system' | 'explore'>('services')

  return (
    <div className="min-h-screen bg-bg-base font-ui">
      <HeaderBar />
      <main className="p-4 md:p-6 lg:p-8">
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-6 animate-in fade-in duration-200">
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'explore' && <ExploreTab />}
        </div>
      </main>
    </div>
  )
}