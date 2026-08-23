import type {
  ServicesResponse,
  Service,
  ActionResult,
  DestroyResult,
  SystemStats,
  ServiceAction,
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
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || `HTTP ${response.status}`)
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

export function getServiceUrl(service: Service, source: ServicesResponse['source']): string {
  if (source === 'local') return service.url
  return service.tailnet_url
}

export function getServiceIconUrl(id: string): string {
  return `/icons/${id}.png`
}