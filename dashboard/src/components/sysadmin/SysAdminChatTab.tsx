import { ExternalLink, MessageSquare, ServerOff } from 'lucide-react'
import { useServices } from '../../hooks/useServices'
import { getServiceUrl } from '../../lib/api'

export function SysAdminChatTab() {
  const services = useServices()
  const openWebUi = services.data?.services.find(service => service.id === 'open-webui')
  const available = Boolean(openWebUi?.launch_available)
  const url = openWebUi ? getServiceUrl(openWebUi) : null

  if (services.isLoading) return <div className="empty-state">Checking Open WebUI availability…</div>

  if (!available) {
    return <section className="sysadmin-chat-empty" aria-labelledby="sysadmin-chat-title">
      <ServerOff aria-hidden="true" />
      <div>
        <span className="eyebrow">Local-only tool</span>
        <h2 id="sysadmin-chat-title">SysAdmin Chat is unavailable</h2>
        <p>{openWebUi?.launch_reason || 'Install and start Open WebUI in Onboarding before using the local admin chat.'}</p>
      </div>
      <button className="button-secondary" disabled aria-disabled="true"><MessageSquare /> Open WebUI not installed</button>
    </section>
  }

  return <section className="sysadmin-chat-empty" aria-labelledby="sysadmin-chat-title">
    <header>
      <div>
        <span className="eyebrow">Local-only tool</span>
        <h2 id="sysadmin-chat-title">SysAdmin Chat</h2>
        <p>Open WebUI is ready through the local Authentik SSO route. It opens in a new tab so the sign-in redirect and session cookies remain reliable.</p>
      </div>
      {url && <a className="button-secondary" href={url} target="_blank" rel="noreferrer">Open SysAdmin Chat <ExternalLink /></a>}
    </header>
    <div className="sysadmin-chat-empty"><MessageSquare aria-hidden="true" /><div><strong>Authentik SSO required</strong><p>Use the launch button to continue through Authentik and open the configured Open WebUI workspace.</p></div></div>
  </section>
}
