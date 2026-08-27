import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, Settings2 } from 'lucide-react'
import { fetchSetupJobs } from '../../lib/api'

const RUNNING = new Set(['queued', 'preparing', 'starting', 'waiting', 'configuring', 'verifying'])

export function SetupActivityStrip({ onOpenSettings, onOpenSystem }: { onOpenSettings: (serviceId: string) => void; onOpenSystem: () => void }) {
  const jobs = useQuery({ queryKey: ['setup-jobs'], queryFn: fetchSetupJobs, refetchInterval: 2000 })
  const [expanded, setExpanded] = useState(false)
  const visible = useMemo(() => {
    const seen = new Set<string>()
    return (jobs.data?.jobs || []).filter(job => {
      if (seen.has(job.target)) return false
      seen.add(job.target)
      return true
    }).slice(0, 5)
  }, [jobs.data?.jobs])
  const activeCount = visible.filter(job => RUNNING.has(job.status) || job.status === 'user_action_required').length
  const attentionCount = visible.filter(job => job.status === 'failed' || job.status === 'user_action_required').length
  useEffect(() => {
    if (activeCount) setExpanded(true)
    else if (jobs.data) setExpanded(false)
  }, [activeCount, jobs.data])
  if (!jobs.data || visible.length === 0) return null
  const running = visible.find(job => RUNNING.has(job.status))
  const handoff = visible.find(job => job.status === 'user_action_required')
  const failed = visible.find(job => job.status === 'failed')
  const headline = failed?.summary || handoff?.summary || running?.summary || 'Setup complete'
  const Icon = failed ? AlertTriangle : running ? LoaderCircle : CheckCircle2
  return <section className={`workspace-setup-activity ${expanded ? 'expanded' : 'collapsed'}`}>
    <button className="workspace-setup-summary" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <Icon className={running ? 'animate-spin' : ''} />
      <span><strong>{headline}</strong><small>{activeCount ? `${activeCount} setup ${activeCount === 1 ? 'job' : 'jobs'} active` : attentionCount ? `${attentionCount} setup ${attentionCount === 1 ? 'item needs' : 'items need'} attention` : 'Latest setup checks are complete'}</small></span>
      {running && <i><b style={{ width: `${running.progress}%` }} /></i>}
      {expanded ? <ChevronUp /> : <ChevronDown />}
    </button>
    {expanded && <div className="workspace-setup-events">
      {visible.map(job => <div key={job.id}>
        <span className={`setup-status setup-status-${job.status}`} />
        <span><strong>{job.summary}</strong><small>{job.error || job.events[job.events.length - 1]?.message}</small></span>
        <em>{job.progress}%</em>
        {(job.status === 'user_action_required' || job.status === 'failed') && <button onClick={() => job.target === 'foundation' ? onOpenSystem() : onOpenSettings(job.target)}><Settings2 /> Setup</button>}
      </div>)}
    </div>}
  </section>
}
