import type { Db, Filter, Document } from 'mongodb'
import type { ObjectId } from 'mongodb'

const SCOPED_METHODS = new Set(['find', 'findOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'insertOne', 'insertMany', 'countDocuments'])

/**
 * Wraps a Db instance so that org_id is injected on every query.
 * This cannot be bypassed by application code — tenant isolation at driver level.
 */
export function createScopedDb(db: Db, orgId: ObjectId): Db {
  return new Proxy(db, {
    get(target, collectionName: string) {
      if (collectionName !== 'collection') return Reflect.get(target, collectionName)
      return (name: string) => {
        const col = target.collection(name)
        return new Proxy(col, {
          get(colTarget, method: string) {
            if (!SCOPED_METHODS.has(method)) {
              return Reflect.get(colTarget, method)
            }
            return (query: Filter<Document>, ...rest: unknown[]) =>
              (colTarget as Record<string, (...args: unknown[]) => unknown>)[method]({ ...query, org_id: orgId }, ...rest)
          },
        })
      }
    },
  }) as Db
}
