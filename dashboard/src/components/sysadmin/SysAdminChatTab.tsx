import { ExternalLink, MessageSquare, ServerOff } from 'lucide-react'
import { useServices } from '../../hooks/useServices'

export function SysAdminChatTab() {
  const services = useServices()
  const openWebUi = services.data?.services.find(service => service.id === 'open-webui')
  const available = openWebUi?.state === 'running' && openWebUi.healthy !== false
  const url = openWebUi?.url || 'http://localhost:8084'

  if (services.isLoading) return <div className="empty-state">Checking Open WebUI availability…</div>

  if (!available) {
    return <section className="sysadmin-chat-empty" aria-labelledby="sysadmin-chat-title">
      <ServerOff aria-hidden="true" />
      <div>
        <span className="eyebrow">Local-only tool</span>
        <h2 id="sysadmin-chat-title">SysAdmin Chat is unavailable</h2>
        <p>Install and start Open WebUI in Onboarding before using the local admin chat.</p>
      </div>
      <button className="button-secondary" disabled aria-disabled="true"><MessageSquare /> Open WebUI not installed</button>
    </section>
  }

  return <section className="sysadmin-chat" aria-labelledby="sysadmin-chat-title">
    <header>
      <div>
        <span className="eyebrow">Local-only tool</span>
        <h2 id="sysadmin-chat-title">SysAdmin Chat</h2>
        <p>Open WebUI is running on this computer. Use it to work with your configured local models and approved tools.</p>
      </div>
      <a className="button-secondary" href={url} target="_blank" rel="noreferrer">Open in a new tab <ExternalLink /></a>
    </header>
    <iframe title="Open WebUI SysAdmin Chat" src={url} />
  </section>
}
