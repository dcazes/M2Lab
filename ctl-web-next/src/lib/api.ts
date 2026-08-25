import type {
  ServicesResponse,
  Service,
  ActionResult,
  DestroyResult,
  SystemStats,
  ServiceAction,
  SetupResponse,
  CatalogResponse,
  AuditEvent,
  CapabilityMatch,
  BootstrapIdentityStatus,
  CalendarConnection,
  CalendarEvent,
  UpdateStatus,
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

export async function createApproval(id: string, action: ServiceAction): Promise<string> {
  const result = await fetchJson<{ token: string }>(`${API_BASE}/approvals`, {
    method: 'POST',
    body: JSON.stringify({ service_id: id, action, confirm: `${action}:${id}` }),
  })
  return result.token
}

export async function serviceAction(id: string, action: ServiceAction, approvalToken: string): Promise<ActionResult> {
  return fetchJson<ActionResult>(`${API_BASE}/services/${id}/${action}`, {
    method: 'POST',
    headers: { 'X-OmniLab-Approval': approvalToken },
  })
}

export async function fetchServiceLogs(id: string, tail = 120): Promise<{ ok: boolean; service_id: string; lines: string[] }> {
  return fetchJson(`${API_BASE}/services/${id}/logs?tail=${tail}`)
}

export async function fetchUpdateStatus(id: string): Promise<UpdateStatus> {
  return fetchJson(`${API_BASE}/services/${id}/update-status`)
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

export async function fetchCatalog(): Promise<CatalogResponse> {
  return fetchJson<CatalogResponse>(`${API_BASE}/catalog`)
}

export async function fetchAudit(): Promise<{ events: AuditEvent[] }> {
  return fetchJson<{ events: AuditEvent[] }>(`${API_BASE}/audit?limit=30`)
}

export async function discoverCapabilities(query: string): Promise<{ query: string; matches: CapabilityMatch[] }> {
  return fetchJson(`${API_BASE}/capabilities?query=${encodeURIComponent(query)}`)
}

export async function prepareInitiateService(id: string): Promise<{ ok: boolean; service_id: string; prepared: string[]; configured: boolean }> {
  return fetchJson(`${API_BASE}/initiate/${id}/prepare`, { method: 'POST' })
}

export async function prepareInstallService(id: string): Promise<{ ok: boolean; service_id: string; prepared: string[]; configured: boolean }> {
  return fetchJson(`${API_BASE}/install/${id}/prepare`, { method: 'POST' })
}

export async function fetchBootstrapIdentity(): Promise<BootstrapIdentityStatus> {
  return fetchJson(`${API_BASE}/bootstrap-identity`)
}

export async function saveBootstrapIdentity(email: string, password: string): Promise<BootstrapIdentityStatus> {
  return fetchJson(`${API_BASE}/bootstrap-identity`, {
    method: 'PUT',
    body: JSON.stringify({ email, password, acknowledge_shared_credential_risk: true }),
  })
}

export async function fetchCalendarConnection(): Promise<CalendarConnection> {
  return fetchJson(`${API_BASE}/connections/nextcloud-calendar`)
}

export async function saveCalendarConnection(username: string, appPassword: string, calendar: string): Promise<CalendarConnection> {
  return fetchJson(`${API_BASE}/connections/nextcloud-calendar`, {
    method: 'PUT',
    body: JSON.stringify({ username, app_password: appPassword, calendar }),
  })
}

export async function fetchCalendarEvents(start: string, end: string): Promise<{ configured: boolean; events: CalendarEvent[] }> {
  const params = new URLSearchParams({ start, end })
  return fetchJson(`${API_BASE}/calendar/events?${params.toString()}`)
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
