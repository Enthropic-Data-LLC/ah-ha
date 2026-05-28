import useSWR from 'swr'
import { fetcher } from '../lib/api'
import type { User } from '../lib/types'

export function useMe() {
  const { data, error, isLoading } = useSWR<{ data: User }>('/auth/me', fetcher, {
    shouldRetryOnError: false,
  })
  return {
    user: data?.data,
    isLoading,
    isLoggedOut: !!error && (error as { status?: number }).status === 401,
  }
}
