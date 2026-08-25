import { CheckCircle2, FileClock, ShieldCheck } from 'lucide-react'
import { useAudit } from '../../hooks/useAudit'

const EVENT_LABELS: Record<string, string> = {
  'approval.granted': 'Approval granted',
  'service.action': 'Service action',
  'service.destroy': 'Service destroyed',
  'service.settings': 'Settings updated',
  'service.secret_regenerated': 'Secret regenerated',
}

export function TrustPanel() {
  const { data } = useAudit()
  const events = data?.events ?? []
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border p-5">
        <div>
          <p className="eyebrow"><ShieldCheck className="h-3.5 w-3.5" /> Trust boundary</p>
          <h3 className="mt-2 font-semibold">Approvals and local audit trail</h3>
        </div>
        <span className="meta-pill text-xs text-ok"><CheckCircle2 className="h-3.5 w-3.5" /> Enforced</span>
      </div>
      <div className="grid lg:grid-cols-[1fr_1.4fr]">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="space-y-4 text-sm">
            <div><strong className="block">Read and draft</strong><span className="text-unknown">Available without operational access.</span></div>
            <div><strong className="block">Lifecycle and writes</strong><span className="text-unknown">Short-lived, action-specific approval required.</span></div>
            <div><strong className="block">Secrets</strong><span className="text-unknown">Write-only in the dashboard and never returned to agents.</span></div>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><FileClock className="h-4 w-4 text-accent" /> Recent activity</div>
          {events.length === 0 ? <p className="mt-4 text-sm text-unknown">No state-changing actions recorded yet.</p> : (
            <div className="mt-4 space-y-2">
              {events.slice(0, 6).map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="flex items-center justify-between gap-4 rounded-lg bg-white/[.025] px-3 py-2 text-xs">
                  <span><strong>{EVENT_LABELS[event.event] ?? event.event}</strong>{event.service_id ? ` · ${event.service_id}` : ''}{event.action ? ` · ${event.action}` : ''}</span>
                  <time className="font-mono-tabular text-unknown">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
