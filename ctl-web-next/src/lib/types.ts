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
  role: 'application' | 'infrastructure'
  visibility: 'user' | 'system' | 'hidden'
  lifecycle: 'managed' | 'always_on' | 'dependency'
  icon: string
  port: number
  url: string
  tailnet_url: string
  tailnet_route_active: boolean | null
  tailnet_proxy: string | null
  external_ready: boolean
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
  tailscale: {
    installed: boolean
    connected: boolean
    hostname: string | null
    serve_ports: number[]
  }
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
  dependencies?: string[]
  setup?: {
    bootstrap: 'automatic' | 'first_login' | 'none'
    identity?: boolean
    model_route?: 'litellm' | 'ollama' | 'none'
    notes?: string[]
  }
  links?: { homepage?: string; source?: string }
  mcp_summary?: {
    summary: string
    example_prompts: string[]
  }
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

export interface BootstrapIdentityStatus {
  configured: boolean
  email: string | null
}

export interface CalendarConnection {
  configured: boolean
  username: string | null
  calendar: string | null
  nextcloud_running: boolean
}

export interface CalendarEvent {
  uid: string
  title: string
  start: string
  end?: string
  all_day: boolean
  calendar: string
}

export interface UpdateStatus {
  service_id: string
  checked: boolean
  update_available: boolean | null
  images: Array<{ image: string; current_digest: string | null; remote_digest: string | null; update_available: boolean | null }>
}

export type SetupJobStatus =
  | 'queued'
  | 'preparing'
  | 'starting'
  | 'waiting'
  | 'configuring'
  | 'verifying'
  | 'user_action_required'
  | 'ready'
  | 'failed'
  | 'cancelled'

export interface SetupJobEvent {
  timestamp: string
  stage: string
  status: SetupJobStatus
  message: string
}

export interface SetupJob {
  id: string
  target: string
  kind: 'foundation' | 'application'
  status: SetupJobStatus
  stage: string
  summary: string
  progress: number
  action: null | { kind: string; label: string; url?: string }
  error: string | null
  created_at: string
  updated_at: string
  events: SetupJobEvent[]
}

export interface SetupJobsResponse {
  jobs: SetupJob[]
  active: number
  attention: number
}

export type McpState = 'unavailable' | 'installing' | 'authentication_required' | 'verifying' | 'live' | 'degraded' | 'disabled'
export type McpKind = 'native' | 'community' | 'omnilab-adapter' | 'unsupported'

export interface McpTool {
  id: string
  title?: string
  label: string
  risk: CapabilityRisk
  effective_risk: CapabilityRisk
  enabled: boolean
  context: string
}

export interface McpServer {
  id: string
  app_id: string
  service_id?: string
  name: string
  icon: string
  app_state: ServiceState | 'unknown'
  kind: McpKind
  transport: 'streamable-http' | 'stdio' | 'none'
  endpoint?: string
  source?: string
  maintainer?: string
  pin?: string
  trust: string
  auth: { type: string; configured: boolean; scopes: string[]; env_ref?: string }
  enabled: boolean
  state: McpState
  error?: string
  context: string
  harnesses: Array<'opencode' | 'open-webui'>
  tools: McpTool[]
  last_verified?: number
}

export interface McpRegistryResponse {
  servers: McpServer[]
  summary: Record<'live' | 'degraded' | 'authentication_required' | 'disabled' | 'unavailable', number>
}

export interface ModelAccessProvider {
  id: string
  name: string
  configured: boolean
  enabled?: boolean
  healthy?: boolean
  key_count?: number
}

export interface ModelAccessResponse {
  services: Record<'freellmapi' | 'ollama' | 'litellm', ServiceState>
  gateway: { available: boolean; wired: boolean }
  free_providers: ModelAccessProvider[]
  direct_providers: ModelAccessProvider[]
  ollama_models: Array<{ name: string; size: number; modified_at?: string }>
}
