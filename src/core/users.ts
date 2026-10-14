import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import type { Caller } from './index.js'
import { signJWT } from '../lib/jwt.js'
import { userTz } from '../lib/repeat.js'

export function usersCore(fastify: FastifyInstance) {
  const users = () => fastify.mongo.collection('users')
  return {
    /** Everyone with an account: who background modules run for. */
    all: () => users().find({}).project<{ _id: ObjectId }>({ _id: 1 }).toArray(),

    /** The user's time zone (briefing settings), as the Link engine reads it. */
    tz: (userId: ObjectId) => userTz(fastify, userId),

    /**
     * A caller acting as [userId] with no request behind it (modules, schedules): a session
     * signed the way sign-in does, so its writes go through the public routes like anyone's.
     * A user's org id is their own id (auth.ts).
     */
    callerFor: async (userId: ObjectId): Promise<Caller> => {
      const user = await users().findOne({ _id: userId })
      if (!user) throw new Error('user not found')
      const token = await signJWT({ id: user._id, orgId: user._id, plan: (user['plan'] as never) ?? 'free', username: (user['username'] as string) ?? '' })
      return { orgId: user._id, userId: user._id, scopes: null, auth: { cookie: `aha_session=${token}` } }
    },
  }
}
