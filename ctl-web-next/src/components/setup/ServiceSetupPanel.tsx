import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Rocket } from 'lucide-react'
import { useApi } from '../../hooks/useApi'
import { type SetupConfigItem } from '../../lib/types'
import { createApproval, serviceAction } from '../../lib/api'
import { toast } from 'sonner'

interface ServiceSetupPanelProps {
  service: import('../../lib/types').Service
}

export function ServiceSetupPanel({ service }: ServiceSetupPanelProps) {
  const { fetchSetup, updateSetup, regenerateSecret } = useApi()
  const [config, setConfig] = useState<Record<string, SetupConfigItem> | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({})
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false)
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    loadSetup()
  }, [service.id])

  async function loadSetup() {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetchSetup(service.id)
      // Ensure each item has a value (even if empty string) for controlled inputs
      const processed: Record<string, SetupConfigItem> = {}
      for (const [key, item] of Object.entries(res.config)) {
        processed[key] = {
          ...item,
          value: item.value ?? '',
        }
      }
      setConfig(processed)
      setDirtyKeys(new Set())
    } catch (err) {
      setError(`Failed to load setup: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSave(): Promise<boolean> {
    if (!config) return false
    setError(null)
    setSuccess(null)
    try {
      // Submit only fields the operator changed. This is essential because
      // secrets are intentionally masked by the API and must not be blanked.
      const payload: Record<string, string> = {}
      for (const [key, item] of Object.entries(config)) {
        if (dirtyKeys.has(key)) payload[key] = item.value ?? ''
      }
      if (Object.keys(payload).length === 0) return true
      const res = await updateSetup(service.id, payload)
      setSuccess(`Saved ${res.written.length} fields`)
      // Reload to reflect any server-side normalization
      await loadSetup()
      return true
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  async function handleSaveAndStart() {
    setStarting(true)
    try {
      if (!(await handleSave())) return
      const action = service.state === 'running' ? 'restart' : 'up'
      const approval = await createApproval(service.id, action)
      const result = await serviceAction(service.id, action, approval)
      if (!result.ok) throw new Error(result.output)
      toast.success(`${service.display_name} is starting`)
    } catch (err) {
      setError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  async function handleRegenerate(key: string) {
    if (!config || !(key in config)) return
    setRegenerating(prev => ({ ...prev, [key]: true }))
    try {
      await regenerateSecret(service.id, key)
      // The server never returns generated secrets; mark it configured only.
      setConfig(prev => {
        if (!prev) return prev
        return {
          ...prev,
          [key]: {
            ...prev[key],
            value: '',
            configured: true,
          },
        }
      })
    } catch (err) {
      setError(`Failed to regenerate: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRegenerating(prev => ({ ...prev, [key]: false }))
    }
  }

  function updateValue(key: string, value: string) {
    setDirtyKeys(prev => new Set(prev).add(key))
    setConfig(prev => !prev ? prev : { ...prev, [key]: { ...prev[key], value } })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6 text-center text-err">
        <p>{error}</p>
        <button
          onClick={loadSetup}
          className="mt-4 px-4 py-2 bg-accent text-bg-base rounded-btn font-medium hover:opacity-90 transition-fast"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="card p-6 text-center text-unknown">
        No setup configuration found for this service.
      </div>
    )
  }

  const providerKeys = new Set(['FREE_LLMAPI_API_KEY', 'NVIDIA_NIM_API_KEY', 'GEMINI_API_KEY', 'HUGGINGFACE_API_KEY', 'MISTRAL_API_KEY', 'OPENAI_API_KEY'])
  const entries = (Object.entries(config) as [string, SetupConfigItem][]).filter(([key]) => service.id !== 'litellm' || !providerKeys.has(key))

  // Split into important (shown by default) and advanced (collapsible)
  const importantEntries = entries.filter(([, item]) => item.priority === 'important')
  const advancedEntries = entries.filter(([, item]) => item.priority === 'advanced')

  const displayKey = (key: string) => key
    .split('_')
    .map(part => ['API', 'URL', 'DB', 'GPU', 'HTTP', 'HTTPS', 'OIDC', 'TTS', 'STT'].includes(part) ? part : part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')

  const renderField = ([key, item]: [string, SetupConfigItem]) => (
    <div className="app-setting-field" key={key}>
      <span className="app-setting-copy">
        <span className="app-setting-title">
          <strong>{displayKey(key)}</strong>
          <code>{key}</code>
          {item.secret && item.configured
            ? <em className="configured">Configured</em>
            : item.required && !item.value ? <em>Required</em> : null}
        </span>
        <small>{item.description}</small>
      </span>
      <span className="app-setting-control">
        <input
          type={item.secret ? 'password' : 'text'}
          value={item.value ?? ''}
          onChange={(event) => updateValue(key, event.target.value)}
          placeholder={item.secret && item.configured ? 'Paste a replacement to rotate' : item.placeholder}
          disabled={regenerating[key]}
        />
        {item.secret && <button type="button" onClick={() => handleRegenerate(key)} disabled={regenerating[key]} title={`Generate a new ${displayKey(key)}`}>
          {regenerating[key] ? <span className="animate-spin">◌</span> : 'Generate'}
        </button>}
      </span>
    </div>
  )

  return (
    <section className="app-settings-editor">
      <header>
        <div><span className="eyebrow">App preferences</span><h3>Customize {service.display_name}</h3><p>Everyday controls first. Deployment internals stay available when you need them.</p></div>
        <div className="app-settings-actions">
          {success && <span>{success}</span>}
          <button className="button-secondary" onClick={handleSave} disabled={dirtyKeys.size === 0}>Save</button>
          <button onClick={handleSaveAndStart} disabled={starting} className="button-primary">
            <Rocket /> {starting ? (service.state === 'running' ? 'Restarting…' : 'Starting…') : service.state === 'running' ? 'Save & restart' : 'Save & start'}
          </button>
        </div>
      </header>

      {importantEntries.length > 0
        ? <div className="app-featured-settings">{importantEntries.map(renderField)}</div>
        : <div className="app-settings-empty"><strong>No everyday controls</strong><span>This app is already using the recommended defaults. Deployment fields remain under Advanced.</span></div>}

      {advancedEntries.length > 0 && <div className="app-advanced-settings">
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? <ChevronDown /> : <ChevronRight />}
          <span><strong>Advanced</strong><small>{advancedEntries.length} deployment and credential settings</small></span>
        </button>
        {showAdvanced && <div className="app-advanced-fields">{advancedEntries.map(renderField)}</div>}
      </div>}

      <footer>Secrets are write-only. Saving a blank unchanged field never erases its stored value.</footer>
    </section>
  )
}
