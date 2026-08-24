import type {
  ServicesResponse,
  Service,
  ActionResult,
  DestroyResult,
  SystemStats,
  ServiceAction,
  SetupResponse,
} from './types'

const API_BASE = '/api'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const message = error.detail || error.message || response.statusText
    // Action/destroy responses include `output` (docker compose output) — surface it.
    const fullMessage = error.output ? `${message}\n${error.output}` : message
    throw new Error(fullMessage || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function fetchServices(): Promise<ServicesResponse> {
  return fetchJson<ServicesResponse>(`${API_BASE}/services`)
}

export async function fetchService(id: string): Promise<Service> {
  const data = await fetchJson<ServicesResponse>(`${API_BASE}/services`)
  const service = data.services.find((s) => s.id === id)
  if (!service) throw new Error(`Service ${id} not found`)
  return service
}

export async function serviceAction(id: string, action: ServiceAction): Promise<ActionResult> {
  return fetchJson<ActionResult>(`${API_BASE}/services/${id}/${action}`, {
    method: 'POST',
  })
}

export async function serviceDestroy(id: string, confirm: string): Promise<DestroyResult> {
  return fetchJson<DestroyResult>(`${API_BASE}/services/${id}/destroy`, {
    method: 'POST',
    body: JSON.stringify({ confirm }),
  })
}

export async function fetchSystemStats(): Promise<SystemStats> {
  return fetchJson<SystemStats>(`${API_BASE}/system`)
}

// ---------- Setup API ----------
export async function fetchSetup(sid: string): Promise<SetupResponse> {
  return fetchJson<SetupResponse>(`${API_BASE}/services/${sid}/setup`)
}

export async function updateSetup(sid: string, config: Record<string, string>): Promise<{ ok: boolean; written: string[] }> {
  return fetchJson(`${API_BASE}/services/${sid}/setup`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export async function regenerateSecret(sid: string, key: string): Promise<{ ok: boolean; key: string; value: string }> {
  return fetchJson(`${API_BASE}/services/${sid}/setup/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ key }),
  })
}

export function getServiceUrl(service: Service): string {
  return service.tailnet_url ?? service.url
}

export function getServiceIconUrl(id: string): string {
  return `/icons/${id}.png`
}