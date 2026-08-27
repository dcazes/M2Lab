import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, Cpu, ExternalLink, Layers, LoaderCircle, ShieldCheck, Sparkles, Terminal, ArrowRight
} from 'lucide-react'
import { toast } from 'sonner'
import { useCatalog } from '../../hooks/useCatalog'
import {
  fetchSystemStats, fetchSetupJobs, wireModelPipeline, createSetupApproval, startSetupTarget,
  resumeSetupJob
} from '../../lib/api'

export function OnboardingWizard() {
  const [step, setStep] = useState<number>(1)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set(['surfsense', 'firecrawl', 'paperless-ngx', 'actual-budget', 'litellm', 'ollama', 'open-webui']))

  // Model setup state
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [pullEmbeddings, setPullEmbeddings] = useState(true)
  const [wiringBusy, setWiringBusy] = useState(false)
  const [wiredDone, setWiredDone] = useState(false)

  // System & Services queries
  const systemQuery = useQuery({ queryKey: ['system-stats'], queryFn: fetchSystemStats })
  const catalogQuery = useCatalog()
  const jobsQuery = useQuery({ queryKey: ['setup-jobs'], queryFn: fetchSetupJobs, refetchInterval: 2000 })
  const queryClient = useQueryClient()

  const apps = catalogQuery.data?.apps || []
  const supportApps = apps.filter(a => a.category === 'agent_support')
  const drivenApps = apps.filter(a => a.category === 'agent_driven')

  const toggleApp = (id: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleWireModels = async () => {
    setWiringBusy(true)
    try {
      const res = await wireModelPipeline({
        NVIDIA_NIM_API_KEY: nvidiaKey.trim() || undefined,
        GEMINI_API_KEY: geminiKey.trim() || undefined,
        pull_embedding: pullEmbeddings,
      })
      if (res.ok) {
        setWiredDone(true)
        toast.success('Model pipeline wired successfully!')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setWiringBusy(false)
    }
  }

  const foundationJob = jobsQuery.data?.jobs.find(j => j.target === 'foundation')
  const startFoundation = async () => {
    try {
      const approval = await createSetupApproval('foundation', 'setup-start')
      await startSetupTarget('foundation', approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-jobs'] })
      toast.success('Authentik identity foundation setup started')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const resumeFoundation = async () => {
    if (!foundationJob) return
    try {
      const approval = await createSetupApproval('foundation', 'setup-resume')
      await resumeSetupJob(foundationJob, approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-jobs'] })
      toast.success('Authentik setup resumed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-5xl bg-surface-1 border border-border rounded-xl p-6 md:p-8 shadow-2xl space-y-8">
      {/* Wizard Header Nav */}
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <span className="eyebrow flex items-center gap-1.5 text-accent font-semibold text-xs uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" /> First-Time Onboarding
          </span>
          <h1 className="text-2xl font-bold text-white mt-1">OmniLab Setup & Initialization</h1>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`w-8 h-8 rounded-full font-bold transition-all ${
                step === s
                  ? 'bg-accent text-bg-base ring-2 ring-accent/50'
                  : step > s
                  ? 'bg-surface-2 text-white border border-accent/40'
                  : 'bg-surface-2 text-unknown border border-border'
              }`}
            >
              {step > s ? <Check className="h-4 w-4 mx-auto" /> : s}
            </button>
          ))}
        </div>
      </div>

      {/* STEP 1: Host & Readiness Overview */}
      {step === 1 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">1. Host & Infrastructure Readiness</h2>
            <p className="text-sm text-unknown mt-1">Verify your system requirements and loopback access before selecting apps.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Docker Engine</span>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-white">Status</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${systemQuery.data?.docker_ok ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400'}`}>
                  {systemQuery.data?.docker_ok ? 'Ready' : 'Not Connected'}
                </span>
              </div>
            </div>

            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Memory & Storage</span>
              <div className="text-sm font-semibold text-white">
                RAM: {systemQuery.data?.mem ? Math.round(systemQuery.data.mem.total / 1073741824) : '--'} GB | Disk: {systemQuery.data?.disk ? systemQuery.data.disk.percent : '--'}%
              </div>
            </div>

            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Tailscale Support</span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{systemQuery.data?.tailscale?.hostname || 'Localhost'}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${systemQuery.data?.tailscale?.connected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400'}`}>
                  {systemQuery.data?.tailscale?.connected ? 'Connected' : 'Loopback'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-5 bg-accent/5 border border-accent/20 rounded-lg flex items-start gap-4">
            <ShieldCheck className="h-6 w-6 text-accent shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">Security & Environment Guarantee</h4>
              <p className="text-xs text-unknown leading-relaxed">
                OmniLab runs host-integrated containers bound exclusively to <code>127.0.0.1</code>. Secrets are generated directly into mode-0600 <code>.env</code> files and never leave your host or return to the browser.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button className="button-primary flex items-center gap-2" onClick={() => setStep(2)}>
              Continue to App Selection <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: App Selection & Categorization */}
      {step === 2 && (
        <div className="space-y-8 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">2. Select Your Applications & MCP Capabilities</h2>
            <p className="text-sm text-unknown mt-1">
              Apps are categorized into <strong>Agent Support Stack</strong> (the brain & scraping tools) vs <strong>Agent-Driven Apps</strong> (productivity platforms controlled by AI).
            </p>
          </div>

          {/* Group 1: Agent Support Stack */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Cpu className="h-5 w-5 text-accent" />
              <h3 className="text-lg font-bold text-white">Agent & Support Stack</h3>
              <span className="text-xs text-unknown">(LLM Gateways, Local Models, Scraping & Audio)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supportApps.map(app => (
                <div
                  key={app.id}
                  onClick={() => toggleApp(app.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all space-y-3 ${
                    selectedApps.has(app.id)
                      ? 'bg-surface-2 border-accent shadow-md'
                      : 'bg-surface-1/50 border-border opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{app.icon}</span>
                      <div>
                        <h4 className="text-base font-bold text-white">{app.name}</h4>
                        <p className="text-xs text-unknown">{app.tagline}</p>
                      </div>
                    </div>
                    <input type="checkbox" checked={selectedApps.has(app.id)} readOnly className="h-4 w-4 rounded accent-accent" />
                  </div>
                  <p className="text-xs text-unknown line-clamp-2">{app.description}</p>

                  {app.mcp_summary && (
                    <div className="p-2.5 bg-bg-base/60 rounded border border-border/50 text-xs space-y-1.5">
                      <div className="font-semibold text-accent flex items-center gap-1">
                        <Terminal className="h-3 w-3" /> MCP Summary
                      </div>
                      <p className="text-unknown text-[11px]">{app.mcp_summary.summary}</p>
                    </div>
                  )}

                  {app.links && (
                    <div className="flex gap-3 text-xs pt-1" onClick={e => e.stopPropagation()}>
                      {app.links.homepage && <a href={app.links.homepage} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">Website <ExternalLink className="h-3 w-3" /></a>}
                      {app.links.source && <a href={app.links.source} target="_blank" rel="noreferrer" className="text-unknown hover:text-white flex items-center gap-1">Source <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Group 2: Agent-Driven Applications */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Layers className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">Agent-Driven Applications</h3>
              <span className="text-xs text-unknown">(Knowledge bases, Finance, Travel & Documents)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {drivenApps.map(app => (
                <div
                  key={app.id}
                  onClick={() => toggleApp(app.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all space-y-3 ${
                    selectedApps.has(app.id)
                      ? 'bg-surface-2 border-emerald-500 shadow-md'
                      : 'bg-surface-1/50 border-border opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{app.icon}</span>
                      <div>
                        <h4 className="text-base font-bold text-white">{app.name}</h4>
                        <p className="text-xs text-unknown">{app.tagline}</p>
                      </div>
                    </div>
                    <input type="checkbox" checked={selectedApps.has(app.id)} readOnly className="h-4 w-4 rounded accent-emerald-500" />
                  </div>
                  <p className="text-xs text-unknown line-clamp-2">{app.description}</p>

                  {app.mcp_summary && (
                    <div className="p-2.5 bg-bg-base/60 rounded border border-border/50 text-xs space-y-1.5">
                      <div className="font-semibold text-emerald-400 flex items-center gap-1">
                        <Terminal className="h-3 w-3" /> MCP Summary & Example Prompts
                      </div>
                      <p className="text-unknown text-[11px]">{app.mcp_summary.summary}</p>
                      {app.mcp_summary.example_prompts.map((promptText: string, idx: number) => (
                        <div key={idx} className="text-[10px] text-emerald-300 font-mono bg-emerald-500/10 px-2 py-0.5 rounded">
                          "{promptText}"
                        </div>
                      ))}
                    </div>
                  )}

                  {app.links && (
                    <div className="flex gap-3 text-xs pt-1" onClick={e => e.stopPropagation()}>
                      {app.links.homepage && <a href={app.links.homepage} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">Website <ExternalLink className="h-3 w-3" /></a>}
                      {app.links.source && <a href={app.links.source} target="_blank" rel="noreferrer" className="text-unknown hover:text-white flex items-center gap-1">Source <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="button-primary flex items-center gap-2" onClick={() => setStep(3)}>
              Continue to AI Model Wiring <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: AI Setup & Gateway Wiring */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">3. AI Model Pipeline Setup</h2>
            <p className="text-sm text-unknown mt-1">
              Configure provider keys and local embeddings. OmniLab routes models: <code>API Key → FreeLLMAPI → LiteLLM → OpenCode / Open WebUI / SurfSense</code>.
            </p>
          </div>

          {/* Diagram */}
          <div className="p-4 bg-bg-base/80 border border-border rounded-lg text-xs space-y-2">
            <span className="font-mono text-accent uppercase font-bold text-[11px]">Model & Embedding Data Flow</span>
            <div className="flex items-center gap-2 overflow-x-auto font-mono text-unknown">
              <span className="px-2.5 py-1 bg-surface-2 rounded border border-border text-white">NVIDIA NIM / Gemini</span>
              <span>→</span>
              <span className="px-2.5 py-1 bg-surface-2 rounded border border-border text-emerald-400">FreeLLMAPI</span>
              <span>→</span>
              <span className="px-2.5 py-1 bg-surface-2 rounded border border-border text-accent">LiteLLM (Port 4000)</span>
              <span>→</span>
              <span className="px-2.5 py-1 bg-surface-2 rounded border border-border text-white">SurfSense & Open WebUI</span>
            </div>
          </div>

          <div className="space-y-4 bg-surface-2 p-5 border border-border rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">1. Add API Keys (NVIDIA NIM Recommended)</h4>
                <p className="text-xs text-unknown">NVIDIA NIM offers a generous free tier with fast llama-3 models.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-white">NVIDIA NIM API Key (Recommended)</span>
                <input
                  type="password"
                  value={nvidiaKey}
                  onChange={e => setNvidiaKey(e.target.value)}
                  placeholder="nvapi-..."
                  className="w-full text-xs p-2.5 bg-bg-base border border-border rounded text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-white">Google Gemini API Key</span>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full text-xs p-2.5 bg-bg-base border border-border rounded text-white"
                />
              </label>
            </div>
          </div>

          <div className="space-y-3 bg-surface-2 p-5 border border-border rounded-lg">
            <h4 className="text-sm font-bold text-white">2. Local Embedding Model Requirement</h4>
            <p className="text-xs text-unknown">
              SurfSense and Paperless require a specific 768-dimension embedding model (<code>nomic-embed-text</code>). OmniLab will automatically pull this via local Ollama.
            </p>
            <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
              <input
                type="checkbox"
                checked={pullEmbeddings}
                onChange={e => setPullEmbeddings(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              <span>Automatically pull <code>nomic-embed-text</code> in Ollama upon confirmation</span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(2)}>Back</button>
            <button
              className="button-primary flex items-center gap-2"
              onClick={handleWireModels}
              disabled={wiringBusy}
            >
              {wiringBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {wiredDone ? 'Re-wire Model Pipeline' : 'Approve & Wire Model Pipeline'}
            </button>
          </div>

          {wiredDone && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400 font-semibold flex items-center justify-between">
              <span>✓ Model pipeline wired successfully! Ready for installation.</span>
              <button className="underline" onClick={() => setStep(4)}>Proceed to Authentik Setup & Downloads →</button>
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Authentik Identity Setup & App Downloads */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">4. Authentik Single Sign-On & Download Progress</h2>
            <p className="text-sm text-unknown mt-1">
              Initialize Authentik identity master account. Selected apps are installed in parallel.
            </p>
          </div>

          {/* Authentik Foundation Status Card */}
          <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="eyebrow text-accent">Single Sign-On Foundation</span>
                <h3 className="text-base font-bold text-white">Authentik Master Account Setup</h3>
              </div>
              <span className={`px-2.5 py-1 rounded text-xs font-bold ${foundationJob?.status === 'ready' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {foundationJob?.status || 'Not Started'}
              </span>
            </div>

            <p className="text-xs text-unknown">
              Authentik provides your single username & password across all homelab apps.
            </p>

            {foundationJob?.action?.url && (
              <div className="p-3 bg-accent/10 border border-accent/30 rounded flex items-center justify-between">
                <span className="text-xs text-white">Action needed: Create master admin user in Authentik</span>
                <a href={foundationJob.action.url} target="_blank" rel="noreferrer" className="button-primary text-xs flex items-center gap-1">
                  Open Authentik Setup <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              {!foundationJob ? (
                <button className="button-primary text-xs" onClick={startFoundation}>Start Authentik Setup</button>
              ) : foundationJob.status === 'user_action_required' ? (
                <button className="button-primary text-xs" onClick={resumeFoundation}>Confirm Authentik Admin Created</button>
              ) : (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1"><Check className="h-4 w-4" /> Authentik Core Ready</span>
              )}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(3)}>Back</button>
            <button className="button-primary flex items-center gap-2" onClick={() => setStep(5)}>
              Complete Setup & View Workspace <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Summary & Launch */}
      {step === 5 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="text-center space-y-2 py-4">
            <span className="text-4xl">🎉</span>
            <h2 className="text-2xl font-bold text-white">Initialization Complete!</h2>
            <p className="text-sm text-unknown max-w-lg mx-auto">
              Your OmniLab control plane, AI model pipeline, and selected apps are online and governed by your single Authentik login.
            </p>
          </div>

          <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-4">
            <h4 className="text-sm font-bold text-white border-b border-border pb-2">Active Applications & Endpoints</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {apps.filter(a => selectedApps.has(a.id)).map(app => (
                <div key={app.id} className="p-3 bg-bg-base border border-border rounded flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{app.icon}</span>
                    <span className="font-semibold text-white">{app.name}</span>
                  </div>
                  <span className="text-emerald-400 font-mono text-[11px]">Ready</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center pt-4">
            <a href="/" className="button-primary px-8 py-3 text-base flex items-center gap-2">
              Go to OmniLab Workspace <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
