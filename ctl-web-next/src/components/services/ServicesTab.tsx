import { useServices } from '../../hooks/useServices'
import { GroupSection } from './GroupSection'
import { GROUP_ORDER, CATEGORY_TO_GROUP, type GroupName } from '../../lib/types'

export function ServicesTab() {
  const { data, isLoading, error, refetch } = useServices()

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
        <p>Failed to load services</p>
        <p className="text-sm text-unknown mt-2">{error.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-4 px-4 py-2 bg-accent text-bg-base rounded-btn font-medium hover:opacity-90 transition-fast"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const grouped: Record<GroupName, typeof data.services> = {
    Media: [],
    Productivity: [],
    'Web and Research': [],
    AI: [],
    Infrastructure: [],
    Other: [],
  }

  for (const service of data.services) {
    const group = CATEGORY_TO_GROUP[service.category] || 'Other'
    grouped[group].push(service)
  }

  return (
    <div className="space-y-8">
      {GROUP_ORDER.map((group) => {
        const services = grouped[group]
        if (services.length === 0) return null
        return <GroupSection key={group} group={group} services={services} source={data.source} />
      })}
    </div>
  )
}