import useSWR from 'swr'
import { fetcher } from '../lib/api'
import { useMe } from './useMe'
import type { Space } from '../lib/types'

/** A space's display name, for page headings. Blank while loading; the slug if it can't be read. */
export function useSpaceName(type: Space['type'], slug: string): string {
  const { user } = useMe()
  const { data, error } = useSWR<{ data: Space }>(user?.username ? `/api/${user.username}/${type}/${slug}` : null, fetcher)
  return data?.data?.name ?? (error ? slug : '')
}
