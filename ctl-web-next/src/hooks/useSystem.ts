import { useQuery } from '@tanstack/react-query'
import { fetchSystemStats } from '../lib/api'
import type { SystemStats } from '../lib/types'

export function useSystem() {
  return useQuery<SystemStats, Error>({
    queryKey: ['system'],
    queryFn: fetchSystemStats,
    refetchInterval: 5000,
  })
}