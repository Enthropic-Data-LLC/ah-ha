import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export interface EntityRef {
  _id: string
  name: string
  icon: string
}

export interface EntityContextState {
  entity: EntityRef | null
  detecting: boolean
  detect: () => Promise<EntityRef | null>
  checkin: (e: EntityRef) => Promise<void>
  checkout: () => Promise<void>
  setLocal: (e: EntityRef | null) => void
}

export function useEntityContext(): EntityContextState {
  const [entity, setEntity] = useState<EntityRef | null>(null)
  const [detecting, setDetecting] = useState(false)

  const detect = useCallback(async (): Promise<EntityRef | null> => {
    setDetecting(true)
    try {
      const signals: Record<string, unknown> = {}

      // GPS
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 })
          )
          signals['gps'] = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        } catch { /* denied or unavailable */ }
      }

      // Network IP via backend
      try {
        const ipRes = await api.get<{ ip: string }>('/api/my-ip')
        signals['network'] = { ip: ipRes.ip }
      } catch { /* unavailable */ }

      // Bluetooth LE scan — Chrome/Android only, silently skip elsewhere
      const bt = navigator as unknown as { bluetooth?: { requestLEScan?: (o: unknown) => Promise<{ addEventListener: (e: string, cb: (e: { device: { name?: string; id: string } }) => void) => void; stop: () => void }> } }
      if (bt.bluetooth?.requestLEScan) {
        try {
          const scan = await bt.bluetooth.requestLEScan({ acceptAllAdvertisements: true })
          const btDevices: Array<{ local_name: string }> = []
          await new Promise<void>(resolve => {
            const tid = setTimeout(() => { scan.stop(); resolve() }, 3000)
            scan.addEventListener('advertisementreceived', (e) => {
              if (e.device.name) btDevices.push({ local_name: e.device.name })
              if (btDevices.length >= 10) { clearTimeout(tid); scan.stop(); resolve() }
            })
          })
          if (btDevices.length > 0) signals['bluetooth'] = btDevices
        } catch { /* BT scan unavailable */ }
      }

      if (!signals['gps'] && !signals['network']) return null

      const res = await api.post<{ data: { best: (EntityRef & { score: number }) | null } }>(
        '/api/entities/detect', signals
      )
      const best = res.data.best ?? null
      if (best) setEntity(best)
      return best
    } finally {
      setDetecting(false)
    }
  }, [])

  const checkin = useCallback(async (e: EntityRef) => {
    await api.post(`/api/entities/${e._id}/checkin`, {})
    setEntity(e)
  }, [])

  const checkout = useCallback(async () => {
    await api.delete('/api/entities/checkin')
    setEntity(null)
  }, [])

  return { entity, detecting, detect, checkin, checkout, setLocal: setEntity }
}
