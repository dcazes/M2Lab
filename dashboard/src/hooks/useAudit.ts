import { useQuery } from '@tanstack/react-query'
import { fetchAudit } from '../lib/api'

export function useAudit() {
  return useQuery({
    queryKey: ['audit'],
    queryFn: fetchAudit,
    refetchInterval: 15_000,
  })
}
