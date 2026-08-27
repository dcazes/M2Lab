import { useCallback } from 'react'
import type {
  ServicesResponse,
  Service,
  ActionResult,
  DestroyResult,
  SystemStats,
  ServiceAction,
  SetupResponse,
} from '../lib/types'

export function useApi() {
  const fetchServices = useCallback(async (): Promise<ServicesResponse> => {
    const res = await fetch('/api/services', {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  const fetchService = useCallback(async (id: string): Promise<Service> => {
    const res = await fetch(`/api/services/${id}`, {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const service = data.services.find((s: Service) => s.id === id)
    if (!service) throw new Error(`Service ${id} not found`)
    return service
  }, [])

  const serviceAction = useCallback(async (id: string, action: ServiceAction): Promise<ActionResult> => {
    const approvalRes = await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: id, action, confirm: `${action}:${id}` }),
    })
    if (!approvalRes.ok) throw new Error(`Approval failed: HTTP ${approvalRes.status}`)
    const { token } = await approvalRes.json()
    const res = await fetch(`/api/services/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-M2Lab-Approval': token },
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.detail || error.message || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  const serviceDestroy = useCallback(async (id: string, confirm: string): Promise<DestroyResult> => {
    const res = await fetch(`/api/services/${id}/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.detail || error.message || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  const fetchSystemStats = useCallback(async (): Promise<SystemStats> => {
    const res = await fetch('/api/system', {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  const fetchSetup = useCallback(async (sid: string): Promise<SetupResponse> => {
    const res = await fetch(`/api/services/${sid}/setup`, {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  const updateSetup = useCallback(async (sid: string, config: Record<string, string>) => {
    const res = await fetch(`/api/services/${sid}/setup`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.detail || error.message || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  const regenerateSecret = useCallback(async (sid: string, key: string) => {
    const res = await fetch(`/api/services/${sid}/setup/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.detail || error.message || `HTTP ${res.status}`)
    }
    return res.json()
  }, [])

  return {
    fetchServices,
    fetchService,
    serviceAction,
    serviceDestroy,
    fetchSystemStats,
    fetchSetup,
    updateSetup,
    regenerateSecret,
  }
}
