import { useQuery } from '@tanstack/react-query'
import { fetchServices } from '../lib/api'
import type { ServicesResponse } from '../lib/types'

export function useServices() {
  return useQuery<ServicesResponse, Error>({
    queryKey: ['services'],
    queryFn: fetchServices,
    refetchInterval: 15000,
  })
}