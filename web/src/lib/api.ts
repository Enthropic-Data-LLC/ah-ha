const BASE = import.meta.env['VITE_API_URL'] ?? ''

export class ApiError extends Error {
  retryAfter?: string
  constructor(public status: number, message: string, retryAfter?: string) {
    super(message)
    this.retryAfter = retryAfter
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    if (res.status === 429) {
      const retryAfter = err.retryAfter ?? res.headers.get('Retry-After') ?? undefined
      const msg = retryAfter
        ? `Too many requests — try again in ${retryAfter}`
        : 'Too many requests — please slow down'
      throw new ApiError(res.status, msg, retryAfter)
    }
    throw new ApiError(res.status, err.error ?? res.statusText)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

// SWR fetcher — returns any so callers control the generic via useSWR<T>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetcher = (path: string): Promise<any> => api.get(path)
