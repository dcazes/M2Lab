import { useEffect, useState } from 'react'
import { HeaderBar } from './HeaderBar'
import { TabNav } from './TabNav'
import { ServicesTab } from '../services/ServicesTab'
import { SystemTab } from '../system/SystemTab'
import { SetupTab } from '../setup/SetupTab'
import { OnboardingWizard } from '../setup/OnboardingWizard'
import { SysAdminChatTab } from '../sysadmin/SysAdminChatTab'

export type AppTab = 'workspace' | 'onboarding' | 'sysadmin-chat' | 'settings' | 'system'

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>('onboarding')
  const [isLocalDashboard, setIsLocalDashboard] = useState(false)
  const [settingsServiceId, setSettingsServiceId] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<'apps' | 'models' | 'mcp'>('apps')

  const openSettings = (serviceId: string) => {
    setSettingsServiceId(serviceId)
    setSettingsSection(serviceId === 'litellm' ? 'models' : 'apps')
    setActiveTab('settings')
  }

  // SysAdmin Chat intentionally has no tailnet entry point: it is available
  // only from the machine hosting the dashboard.
  useEffect(() => {
    if (typeof window !== 'undefined') setIsLocalDashboard(window.location.hostname === '127.0.0.1')
  }, [])

  return (
    <div className="min-h-screen bg-bg-base font-ui">
      <HeaderBar />
      <main className="mx-auto max-w-[1500px] p-4 md:p-6 lg:p-8">
        <TabNav activeTab={activeTab} onChange={setActiveTab} showSysAdminChat={isLocalDashboard} />
        <div className="mt-6 animate-in fade-in duration-200">
          {activeTab === 'workspace' && <ServicesTab onOpenSettings={openSettings} onOpenSystem={() => setActiveTab('system')} />}
          {activeTab === 'onboarding' && <OnboardingWizard onGoWorkspace={() => setActiveTab('workspace')} />}
          {activeTab === 'sysadmin-chat' && isLocalDashboard && <SysAdminChatTab />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'settings' && <SetupTab initialSelectedId={settingsServiceId} initialSection={settingsSection} />}
        </div>
      </main>
    </div>
  )
}
