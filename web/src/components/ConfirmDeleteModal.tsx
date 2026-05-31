interface Props {
  name: string
  type: string
  onConfirm: () => void
  onCancel: () => void
  deleting?: boolean
}

export default function ConfirmDeleteModal({ name, type, onConfirm, onCancel, deleting }: Props) {
  const contentLabel: Record<string, string> = {
    board: 'all cards and columns',
    trail: 'all entries',
    note: 'the note content',
    list: 'all items',
    table: 'all rows and columns',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
        <h2 className="text-base font-semibold">Delete &ldquo;{name}&rdquo;?</h2>
        <p className="text-sm text-slate-400">
          This permanently removes {contentLabel[type] ?? 'all content'} and cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-sm font-medium rounded-lg transition"
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
