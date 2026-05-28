const BASE_URL = process.env['AHA_BASE_URL'] ?? 'https://api.ah-ha.app'
const API_KEY = process.env['AHA_API_KEY'] ?? ''

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(BASE_URL + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'X-Aha-Source': 'mcp',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Ah-Ha API ${method} ${path} → ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export const get = <T>(path: string, query?: Record<string, string | number | undefined>) =>
  api<T>('GET', path, undefined, query)

export const post = <T>(path: string, body: unknown) => api<T>('POST', path, body)
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body)
export const del = <T>(path: string) => api<T>('DELETE', path)
