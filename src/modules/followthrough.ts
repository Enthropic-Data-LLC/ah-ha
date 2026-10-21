import Anthropic from '@anthropic-ai/sdk'
import type { Caller, Core, Doc } from '../core/index.js'

/**
 * Follow-through: notices a card or list item snoozed three times and works out one
 * small first step for it (stored on the item as `followthrough`). Ah! Today then
 * brings it forward with "snoozed 3 times" and the step as its reasons; finishing it
 * clears both. It never notifies on its own.
 */
export const ID = 'ah-followthrough'
export const SNOOZES = 3
const STEPS_PER_DAY = 3
const MODEL = 'claude-opus-5-5'

/** One plain line: no quotes, no "First step:" lead-in, at most ~90 characters. */
export function cleanStep(text: string): string | null {
  const line = text.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  const s = line.replace(/^["'“‘\s]+|["'”’\s]+$/g, '').replace(/^(first step|step|try)\s*[:\-–]\s*/i, '').trim()
  if (!s) return null
  return s.length > 90 ? s.slice(0, 89).replace(/\s+\S*$/, '') + '…' : s
}

async function firstStep(apiKey: string, title: string): Promise<string | null> {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: `Someone has put off this task three times: "${title}". Suggest one concrete first step they could do in under five minutes that makes starting easy. Reply with the step only: one short sentence, under 12 words, no preamble, no quotes.`,
    }],
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
  if (res.stop_reason === 'refusal') return null
  const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')
  return cleanStep(text)
}

export async function run(c: Core, caller: Caller, day: string) {
  const [cards, items] = await Promise.all([
    c.cards.snoozedOften(caller, SNOOZES, 20),
    c.lists.snoozedOften(caller, SNOOZES, 20),
  ])
  const fresh = (d: Doc) => !(d['followthrough'] as { at?: unknown } | null | undefined)?.at
  const todo = [...cards.filter(fresh).map(d => ['card', d] as const), ...items.filter(fresh).map(d => ['item', d] as const)]
  if (!todo.length) return { marked: [] }

  const budget = c.kv('modules')
  const key = `${ID}:steps:${caller.orgId}:${day}`
  const ai = await c.settings.aiKey(caller)
  const marked: string[] = []
  for (const [kind, d] of todo) {
    let step: string | null = null
    if (ai) {
      const used = Number(await budget.get(key) ?? 0)
      if (used >= STEPS_PER_DAY) break            // today's suggestions are used up: the rest wait for tomorrow
      await budget.set(key, String(used + 1), 2 * 86_400)
      ai.used()
      step = await firstStep(ai.key, String(d['title'])).catch(() => null)
    }
    const ft = { at: new Date(), count: Number(d['defer_count'] ?? SNOOZES), first_step: step, by: ID }
    await (kind === 'card' ? c.cards.setFollowThrough(caller, d._id, ft) : c.lists.setFollowThrough(caller, d._id, ft))
    marked.push(String(d['title']))
  }
  return { marked }
}
