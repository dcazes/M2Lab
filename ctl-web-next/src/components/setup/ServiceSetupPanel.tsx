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

  function isSecretField(item: SetupConfigItem): boolean {
    return item.secret
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

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{service.display_name} Setup</h2>
        <div className="flex items-center gap-2">
          {success && (
            <span className="px-3 py-1 rounded-btn bg-accent/20 text-accent text-xs">
              {success}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={dirtyKeys.size === 0}
            className={`px-4 py-2 rounded-btn font-medium transition-fast ${
              dirtyKeys.size > 0
                ? 'bg-accent text-bg-base hover:opacity-90'
                : 'bg-surface-2 text-unknown hover:bg-surface-1 hover:text-white'
            }`}
          >
            Save Changes
          </button>
          <button onClick={handleSaveAndStart} disabled={starting} className="button-primary">
            <Rocket className="h-4 w-4" /> {starting ? (service.state === 'running' ? 'Restarting…' : 'Starting…') : service.state === 'absent' ? 'Save & install' : service.state === 'running' ? 'Save & restart' : 'Save & start'}
          </button>
        </div>
      </div>

      {/* Important settings - always visible */}
      {importantEntries.length > 0 && (
        <div className="space-y-4">
          {importantEntries.map(([key, item]) => (
            <div key={key} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <span className="flex-1">{key}</span>
                {item.required && (
                  <span className="px-2 py-0.5 rounded-btn bg-err/20 text-err text-xs">
                    required
                  </span>
                )}
              </label>
              <p className="text-xs text-unknown">{item.description || (item.secret && item.configured ? 'Configured — enter a replacement only if you want to rotate it.' : '')}</p>
              <div className="flex items-center gap-2">
                {isSecretField(item) ? (
                  <>
                    <input
                      type="password"
                      value={item.value ?? ''}
                      onChange={(e) => updateValue(key, e.target.value)}
                      className={`w-full px-3 py-2 rounded-btn border border-border bg-surface-2 text-unknown focus:outline-none focus:ring-2 focus:ring-accent ${
                        regenerating[key] ? 'opacity-50' : ''
                      }`}
                      placeholder={item.configured ? 'Configured — paste a replacement to rotate' : item.placeholder}
                      disabled={regenerating[key]}
                    />
                    {regenerating[key] && (
                      <span className="animate-spin h-4 w-4" />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRegenerate(key)}
                      disabled={regenerating[key]}
                      className={`ml-2 px-3 py-1 rounded-btn text-xs transition-fast ${
                        regenerating[key]
                          ? 'opacity-50 cursor-not-allowed'
                          : 'text-unknown hover:text-white hover:bg-surface-2'
                      }`}
                    >
                      {regenerating[key] ? 'Generating' : '🔑'}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={item.value ?? ''}
                      onChange={(e) => updateValue(key, e.target.value)}
                      className={`w-full px-3 py-2 rounded-btn border border-border bg-surface-2 text-unknown focus:outline-none focus:ring-2 focus:ring-accent ${
                        regenerating[key] ? 'opacity-50' : ''
                      }`}
                      placeholder={item.placeholder}
                      disabled={regenerating[key]}
                    />
                    {regenerating[key] && (
                      <span className="animate-spin h-4 w-4" />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Advanced settings - collapsible */}
      {advancedEntries.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 mt-6 mb-2 px-3 py-2 text-sm font-medium text-unknown hover:text-white bg-surface-2 hover:bg-surface-1 rounded-btn transition-fast w-full"
          >
            {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>Advanced settings ({advancedEntries.length})</span>
          </button>
          {showAdvanced && (
            <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
              {advancedEntries.map(([key, item]) => (
                <div key={key} className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <span className="flex-1">{key}</span>
                    {item.required && (
                      <span className="px-2 py-0.5 rounded-btn bg-err/20 text-err text-xs">
                        required
                      </span>
                    )}
                  </label>
                  <p className="text-xs text-unknown">{item.description || (item.secret && item.configured ? 'Configured — enter a replacement only if you want to rotate it.' : '')}</p>
                  <div className="flex items-center gap-2">
                    {isSecretField(item) ? (
                      <>
                        <input
                          type="password"
                          value={item.value ?? ''}
                          onChange={(e) => updateValue(key, e.target.value)}
                          className={`w-full px-3 py-2 rounded-btn border border-border bg-surface-2 text-unknown focus:outline-none focus:ring-2 focus:ring-accent ${
                            regenerating[key] ? 'opacity-50' : ''
                          }`}
                          placeholder={item.configured ? 'Configured — paste a replacement to rotate' : item.placeholder}
                          disabled={regenerating[key]}
                        />
                        {regenerating[key] && (
                          <span className="animate-spin h-4 w-4" />
                        )}
                        <button
                          type="button"
                          onClick={() => handleRegenerate(key)}
                          disabled={regenerating[key]}
                          className={`ml-2 px-3 py-1 rounded-btn text-xs transition-fast ${
                            regenerating[key]
                              ? 'opacity-50 cursor-not-allowed'
                              : 'text-unknown hover:text-white hover:bg-surface-2'
                          }`}
                        >
                          {regenerating[key] ? 'Generating' : '🔑'}
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={item.value ?? ''}
                          onChange={(e) => updateValue(key, e.target.value)}
                          className={`w-full px-3 py-2 rounded-btn border border-border bg-surface-2 text-unknown focus:outline-none focus:ring-2 focus:ring-accent ${
                            regenerating[key] ? 'opacity-50' : ''
                          }`}
                          placeholder={item.placeholder}
                          disabled={regenerating[key]}
                        />
                        {regenerating[key] && (
                          <span className="animate-spin h-4 w-4" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="border-t pt-4 mt-6 text-xs text-unknown">
        <p>
          Changes are written directly to the service's <code className="font-mono-tabular bg-surface-2 px-1 py-0.5 rounded">.env</code> file.
          After saving, you may need to restart the service for changes to take effect.
        </p>
        <p className="mt-2">
          <strong>Never commit .env files.</strong> They are gitignored by <code className="font-mono-tabular bg-surface-2 px-1 py-0.5 rounded">*.env</code>.
        </p>
      </div>
    </>
  )
}
