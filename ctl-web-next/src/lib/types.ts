export interface ServiceContainer {
  container: string
  service: string
  state: string
  health: string | null
}

export interface Service {
  id: string
  display_name: string
  description: string
  category: string
  icon: string
  port: number
  url: string
  tailnet_url: string
  state: 'running' | 'stopped' | 'degraded' | 'absent'
  containers: ServiceContainer[]
  healthy: boolean | null
}

export interface ServicesResponse {
  services: Service[]
  source: 'local' | 'tailnet' | `other:${string}`
}

export interface ActionResult {
  ok: boolean
  output: string
}

export interface DestroyResult {
  ok: boolean
  output: string
}

export interface SystemStats {
  cpu_percent: number
  mem: {
    total: number
    available: number
    percent: number
    used: number
    free: number
  }
  disk: {
    total: number
    used: number
    percent: number
  }
  docker_ok: boolean
  uptime_seconds: number
  load_avg: [number, number, number]
}

export type LogEventType = 'meta' | 'log'

export interface LogMetaEvent {
  event: 'meta'
  data: {
    container: string
  }
}

export interface LogLineEvent {
  event: 'log'
  data: {
    c: string
    line: string
  }
}

export type LogEvent = LogMetaEvent | LogLineEvent

export type ServiceState = Service['state']

export const STATE_COLORS: Record<ServiceState, string> = {
  running: 'var(--color-ok)',
  stopped: 'var(--color-err)',
  degraded: 'var(--color-warn)',
  absent: 'var(--color-unknown)',
}

export const STATE_LABELS: Record<ServiceState, string> = {
  running: 'Running',
  stopped: 'Stopped',
  degraded: 'Degraded',
  absent: 'Absent',
}

export type ServiceAction = 'up' | 'stop' | 'restart' | 'pull' | 'update'

export const SERVICE_ACTIONS: ServiceAction[] = ['up', 'stop', 'restart', 'pull', 'update']

export interface GroupedServices {
  group: string
  services: Service[]
}

export const GROUP_ORDER = [
  'Media',
  'Productivity',
  'Web and Research',
  'AI',
  'Infrastructure',
  'Other',
] as const

export type GroupName = (typeof GROUP_ORDER)[number]

export const CATEGORY_TO_GROUP: Record<string, GroupName> = {
  media: 'Media',
  productivity: 'Productivity',
  'web-research': 'Web and Research',
  ai: 'AI',
  infrastructure: 'Infrastructure',
}

// ---------- Setup types ----------
export interface SetupConfigItem {
  placeholder: string
  description: string
  required: boolean
  value?: string
  secret: boolean
  configured?: boolean
  priority: 'important' | 'advanced'
}

export interface SetupResponse {
  service_id: string
  config: Record<string, SetupConfigItem>
}

export type CatalogKind = 'service' | 'companion' | 'infrastructure' | 'harness'
export type CatalogAvailability = 'available' | 'evaluation' | 'planned'
export type CapabilityRisk = 'read' | 'draft' | 'write' | 'operational' | 'destructive' | 'privileged'

export interface CatalogCapability {
  id: string
  title: string
  risk: CapabilityRisk
  tools: string[]
}

export interface CapabilityMatch extends CatalogCapability {
  app_id: string
  app_name: string
}

export interface CatalogApp {
  id: string
  service_id?: string
  name: string
  tagline: string
  description: string
  category: string
  kind: CatalogKind
  availability: CatalogAvailability
  icon: string
  accent: string
  setup_minutes: number
  ai_optional: boolean
  outcomes: string[]
  requirements: string[]
  links?: { homepage?: string; source?: string }
  capabilities: CatalogCapability[]
}

export interface CatalogProfile {
  id: string
  name: string
  description: string
  icon: string
  apps: string[]
}

export interface CatalogWorkflow {
  id: string
  name: string
  description: string
  apps: string[]
  status: 'design' | 'pilot' | 'available'
}

export interface CatalogResponse {
  schema_version: number
  profiles: CatalogProfile[]
  workflows: CatalogWorkflow[]
  apps: CatalogApp[]
}

export interface AuditEvent {
  timestamp: string
  event: string
  source: string
  service_id?: string
  action?: string
  ok?: boolean
  keys?: string[]
}
