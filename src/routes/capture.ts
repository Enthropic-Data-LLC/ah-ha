import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

// POST /api/board/:slug/cards/capture — NL text → parsed card fields
export const captureRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { slug: string } }>(
    '/api/board/:slug/cards/capture',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { text } = z.object({ text: z.string().min(1).max(500) }).parse(req.body)

      // Get AI key: user BYOK or server key
      const settings = await fastify.mongo.collection('user_settings')
        .findOne({ user_id: req.user!.id })
      const apiKey = (settings?.['anthropic_api_key'] as string | null) ?? process.env['ANTHROPIC_API_KEY']

      if (!apiKey) {
        // No AI key — return raw title, no parsing
        return { data: { title: text, due_date: null, recurrence: null, parsed: false } }
      }

      const now = new Date()
      const dayName = now.toLocaleDateString('en-US', { weekday: 'long' })
      const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      const prompt = `Extract task info from this text. Today is ${dayName}, ${dateStr}.

Text: "${text}"

Return ONLY valid JSON (no markdown):
{
  "title": "cleaned task title, remove date/time language",
  "due_date": "ISO 8601 datetime or null",
  "start_date": "ISO 8601 datetime or null",
  "recurrence": {
    "archetype": "habit|schedule|interval|null",
    "time_anchor": "morning|midday|evening|night or null",
    "day_of_week": 0-6 or null,
    "interval_days": number or null
  } | null
}

Examples:
"take meds every morning" → title:"Take meds", recurrence:{archetype:"habit",time_anchor:"morning"}
"trash every tuesday" → title:"Take out trash", recurrence:{archetype:"schedule",day_of_week:2}
"call Sarah every 3 weeks" → title:"Call Sarah", recurrence:{archetype:"interval",interval_days:21}
"submit report by friday" → title:"Submit report", due_date:"<this Friday ISO>", recurrence:null
"dentist appointment tomorrow" → title:"Dentist appointment", due_date:"<tomorrow ISO>", recurrence:null`

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!res.ok) {
          fastify.log.warn({ status: res.status }, 'AI capture API error')
          return { data: { title: text, due_date: null, recurrence: null, parsed: false } }
        }

        const data = await res.json() as { content: Array<{ type: string; text: string }> }
        const raw = data.content[0]?.text ?? ''
        const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim())
        return { data: { ...parsed, parsed: true } }
      } catch (err) {
        fastify.log.warn({ err }, 'AI capture parse error')
        return { data: { title: text, due_date: null, recurrence: null, parsed: false } }
      }
    }
  )
}
