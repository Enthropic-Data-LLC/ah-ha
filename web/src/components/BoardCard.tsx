import { Draggable } from '@hello-pangea/dnd'
import type { BoardCard } from '../lib/types'

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low:    'bg-sky-500/20 text-sky-400 border-sky-500/30',
  none:   '',
}

interface Props {
  card: BoardCard
  index: number
  onClick: (card: BoardCard) => void
}

export default function BoardCardItem({ card, index, onClick }: Props) {
  return (
    <Draggable draggableId={card._id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(card)}
          className={`px-3 py-2.5 rounded-lg bg-slate-800 border cursor-pointer select-none space-y-1.5 transition
            ${snapshot.isDragging
              ? 'border-indigo-500 shadow-xl shadow-indigo-900/30 rotate-1'
              : 'border-slate-700 hover:border-slate-600'
            }
            ${card.color ? `border-l-2` : ''}
          `}
          style={{
            ...provided.draggableProps.style,
            borderLeftColor: card.color || undefined,
          }}
        >
          <p className="text-sm leading-snug">{card.title}</p>

          {(card.priority !== 'none' || card.tags.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {card.priority !== 'none' && (
                <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${PRIORITY_COLORS[card.priority]}`}>
                  {card.priority}
                </span>
              )}
              {card.tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {card.notes && (
            <p className="text-xs text-slate-500 line-clamp-2">{card.notes}</p>
          )}
        </div>
      )}
    </Draggable>
  )
}
