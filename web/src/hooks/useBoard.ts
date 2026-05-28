import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import type { BoardColumn, BoardCard } from '../lib/types'

export function useBoardColumns(slug: string) {
  return useSWR<{ data: BoardColumn[] }>(`/api/board/${slug}/columns`, fetcher)
}

export function useBoardCards(slug: string, columnId?: string) {
  const url = `/api/board/${slug}/cards${columnId ? `?column_id=${columnId}` : ''}`
  return useSWR<{ data: BoardCard[] }>(url, fetcher)
}

export function useBoardActions(slug: string) {
  return {
    createCard: (body: { column_id: string; title: string; notes?: string; priority?: BoardCard['priority'] }) =>
      api.post<{ data: BoardCard }>(`/api/board/${slug}/cards`, body),

    updateCard: (id: string, body: Partial<Pick<BoardCard, 'title' | 'notes' | 'priority' | 'tags' | 'color'>>) =>
      api.patch(`/api/board/${slug}/cards/${id}`, body),

    moveCard: (id: string, body: { column_id: string; before_id?: string | null; after_id?: string | null }) =>
      api.patch(`/api/board/${slug}/cards/${id}/move`, body),

    deleteCard: (id: string) =>
      api.delete(`/api/board/${slug}/cards/${id}`),

    createColumn: (body: { title: string; color?: string }) =>
      api.post<{ data: BoardColumn }>(`/api/board/${slug}/columns`, body),
  }
}
