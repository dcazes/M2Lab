import { ServiceCard } from './ServiceCard'
import type { Service } from '../../lib/types'

interface GroupSectionProps {
  group: string
  services: Service[]
  source: 'local' | 'tailnet' | `other:${string}`
}

export function GroupSection({ group, services, source }: GroupSectionProps) {
  return (
    <section aria-labelledby={`${group.toLowerCase()}-heading`}>
      <h2 id={`${group.toLowerCase()}-heading`} className="text-lg font-semibold text-unknown mb-4 flex items-center gap-2">
        <span className="text-accent">{group}</span>
        <span className="text-sm font-mono-tabular text-unknown bg-surface-2 px-2 py-0.5 rounded-btn">
          {services.length}
        </span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {services.map((service) => (
          <ServiceCard key={service.id} service={service} source={source} />
        ))}
      </div>
    </section>
  )
}