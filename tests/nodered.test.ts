import { describe, it, expect, vi, afterEach } from 'vitest'
import { postToNodeRed } from '../src/lib/nodered.js'

afterEach(() => vi.restoreAllMocks())

describe('postToNodeRed', () => {
  it('does not send when the user has no Telegram chat (Node-RED would fall back to a default chat)', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    expect(await postToNodeRed('daily_briefing', 'someone', { message: 'hi', telegram_chat_id: undefined }, () => {})).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('sends when a chat id is present', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    expect(await postToNodeRed('daily_briefing', 'someone', { message: 'hi', telegram_chat_id: '123' }, () => {})).toBe(true)
    expect(f).toHaveBeenCalledOnce()
  })
})
