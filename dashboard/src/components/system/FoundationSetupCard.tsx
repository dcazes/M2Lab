import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, KeyRound, LoaderCircle, RefreshCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useServices } from '../../hooks/useServices'
import { useSystem } from '../../hooks/useSystem'
import { createSetupApproval, fetchSetupJobs, resumeSetupJob, startSetupTarget } from '../../lib/api'

const SERVICE_IDS = ['authentik', 'sso-ingress', 'vaultwarden']
const ACTIVE = new Set(['queued', 'preparing', 'starting', 'waiting', 'configuring', 'verifying'])

export function FoundationSetupCard() {
  const queryClient = useQueryClient()
  const services = useServices()
  const system = useSystem()
  const jobs = useQuery({ queryKey: ['setup-jobs'], queryFn: fetchSetupJobs, refetchInterval: 2000 })
  const [busy, setBusy] = useState(false)
  const foundation = jobs.data?.jobs.find(job => job.target === 'foundation')
  const serviceMap = new Map(services.data?.services.map(service => [service.id, service]) || [])
  const components = [
    { id: 'docker', name: 'Docker', ready: system.data?.docker_ok === true },
    { id: 'tailscale', name: 'Tailscale', ready: system.data?.tailscale.connected === true },
    ...SERVICE_IDS.map(id => {
      const service = serviceMap.get(id)
      return { id, name: service?.display_name || id, ready: service?.state === 'running' && service.healthy !== false }
    }),
  ]
  const runtimeReady = components.every(component => component.ready)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['setup-jobs'] }),
      queryClient.invalidateQueries({ queryKey: ['services'] }),
      queryClient.invalidateQueries({ queryKey: ['system'] }),
    ])
  }
  const start = async () => {
    setBusy(true)
    try {
      const approval = await createSetupApproval('foundation', 'setup-start')
      await startSetupTarget('foundation', approval)
      await refresh()
      toast.success('Infrastructure setup started')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const resume = async () => {
    if (!foundation) return
    setBusy(true)
    try {
      const approval = await createSetupApproval('foundation', 'setup-resume')
      await resumeSetupJob(foundation, approval)
      await refresh()
      toast.success(
        foundation.stage === 'create_owner'
          ? 'Identity foundation completed'
          : foundation.stage === 'create_vaultwarden_owner'
            ? 'Vaultwarden step done — continue to Authentik'
            : 'Infrastructure check resumed',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const active = foundation ? ACTIVE.has(foundation.status) : false
  const canStart = !foundation || foundation.status === 'failed' || foundation.status === 'cancelled' || (foundation.status === 'ready' && !runtimeReady)
  return <section className="settings-foundation-card system-foundation-card">
    <div className="settings-foundation-icon"><KeyRound /></div>
    <div className="settings-foundation-copy">
      <span className="eyebrow">Private access foundation</span>
      <h3>{foundation?.summary || 'Set up one identity before app accounts'}</h3>
      <p>{foundation?.error || foundation?.events[foundation.events.length - 1]?.message || 'M2Lab checks Docker and Tailscale, then starts PostgreSQL, Authentik, Caddy, private routing, and Vaultwarden.'}</p>
      {foundation?.action?.url && <a href={foundation.action.url} target="_blank" rel="noreferrer">{foundation.action.label} <ExternalLink /></a>}
    </div>
    <div className="settings-foundation-progress">
      <div>{components.map(component => <span key={component.id} className={component.ready ? 'ready' : ''}><i />{component.name}</span>)}</div>
      {foundation && <progress max={100} value={foundation.progress} />}
      {foundation?.status === 'user_action_required'
        ? <button className="button-primary" onClick={resume} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}{foundation.stage === 'create_owner' || foundation.stage === 'create_vaultwarden_owner' ? 'I finished this step' : 'Retry private route'}</button>
        : canStart
          ? <button className="button-primary" onClick={start} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : foundation?.status === 'ready' ? <RefreshCcw /> : <ShieldCheck />}{foundation?.status === 'ready' ? 'Repair infrastructure' : 'Start identity setup'}</button>
          : foundation?.status === 'ready' && runtimeReady
            ? <span className="settings-foundation-ready"><Check /> Infrastructure ready</span>
            : <span className="settings-foundation-running"><LoaderCircle className="animate-spin" /> {active ? 'Setup continues in the background' : 'Checking infrastructure'}</span>}
    </div>
  </section>
}
