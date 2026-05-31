import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState, useRef, useEffect } from 'react'
import { useMe } from '../hooks/useMe'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multiselect'

interface TableColumn {
  _id: string
  name: string
  type: ColType
  options: string[]
  position: number
}

interface TableRow {
  _id: string
  cells: Record<string, unknown>
  position: number
}

interface TableData {
  columns: TableColumn[]
  rows: TableRow[]
}

const TYPE_BADGE: Record<ColType, string> = {
  text: 'T',
  number: '#',
  date: '📅',
  checkbox: '☑',
  select: '▾',
  multiselect: '▾▾',
}

function formatCell(value: unknown, type: ColType): string {
  if (value === undefined || value === null || value === '') return ''
  if (type === 'checkbox') return value ? '✓' : ''
  if (type === 'date' && typeof value === 'string') {
    try { return new Date(value).toLocaleDateString() } catch { return value }
  }
  if (type === 'multiselect' && Array.isArray(value)) return value.join(', ')
  return String(value)
}

function CellEditor({
  col,
  initial,
  onSave,
  onCancel,
}: {
  col: TableColumn
  initial: unknown
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState<unknown>(initial ?? (col.type === 'checkbox' ? false : col.type === 'multiselect' ? [] : ''))
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  function commit() { onSave(val) }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') onCancel()
  }

  if (col.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(val)}
        onChange={e => { setVal(e.target.checked); onSave(e.target.checked) }}
        className="w-4 h-4 accent-indigo-500"
        autoFocus
      />
    )
  }

  if (col.type === 'select') {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={String(val ?? '')}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        className="w-full bg-slate-800 text-sm text-slate-100 border border-indigo-500 rounded px-1 py-0.5 focus:outline-none"
      >
        <option value="">—</option>
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  if (col.type === 'multiselect') {
    const current = Array.isArray(val) ? val as string[] : []
    return (
      <div className="flex flex-wrap gap-1">
        {col.options.map(o => (
          <button
            key={o}
            type="button"
            onClick={() => {
              const next = current.includes(o) ? current.filter(x => x !== o) : [...current, o]
              setVal(next)
            }}
            className={`text-xs px-1.5 py-0.5 rounded transition ${current.includes(o) ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
          >
            {o}
          </button>
        ))}
        <button type="button" onClick={commit} className="text-xs px-1.5 py-0.5 rounded bg-slate-600 text-slate-300 ml-1">✓</button>
      </div>
    )
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      value={col.type === 'date' && typeof val === 'string' ? val.slice(0, 10) : String(val ?? '')}
      onChange={e => setVal(col.type === 'number' ? Number(e.target.value) : e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
      className="w-full bg-slate-800 text-sm text-slate-100 border border-indigo-500 rounded px-1 py-0.5 focus:outline-none min-w-0"
    />
  )
}

export default function TablePage({ slug }: { slug: string }) {
  const { user } = useMe()
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function deleteSpace() {
    if (!user?.username) return
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(`${user.username}/table/${slug}`)}`)
      window.location.href = `/${user.username}/spaces`
    } catch { setDeleting(false) }
  }

  const { data, mutate } = useSWR<{ data: TableData }>(`/api/table/${slug}`, fetcher)

  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null)
  const [showAddCol, setShowAddCol] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColType>('text')
  const [newColOptions, setNewColOptions] = useState('')

  const columns = data?.data.columns ?? []
  const rows = data?.data.rows ?? []

  async function saveCell(rowId: string, colId: string, value: unknown) {
    setEditing(null)
    await api.patch(`/api/table/${slug}/rows/${rowId}`, { cells: { [colId]: value } })
    await mutate()
  }

  async function addRow() {
    await api.post(`/api/table/${slug}/rows`, { cells: {} })
    await mutate()
  }

  async function deleteRow(id: string) {
    await api.delete(`/api/table/${slug}/rows/${id}`)
    await mutate()
  }

  async function deleteColumn(id: string) {
    await api.delete(`/api/table/${slug}/columns/${id}`)
    await mutate()
  }

  async function addColumn(e: React.FormEvent) {
    e.preventDefault()
    if (!newColName.trim()) return
    const options = newColOptions ? newColOptions.split(',').map(s => s.trim()).filter(Boolean) : []
    await api.post(`/api/table/${slug}/columns`, { name: newColName.trim(), type: newColType, options })
    setNewColName('')
    setNewColType('text')
    setNewColOptions('')
    setShowAddCol(false)
    await mutate()
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full px-4 py-6 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold capitalize">{slug}</h1>
        <button onClick={() => setShowDelete(true)} className="text-slate-700 hover:text-red-400 text-xs transition" title="Delete table">✕</button>
      </div>
        <button
          onClick={() => setShowAddCol(s => !s)}
          className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition"
        >
          + Column
        </button>
      </div>

      {showAddCol && (
        <form onSubmit={addColumn} className="flex flex-wrap gap-2 items-end p-3 bg-slate-900 border border-slate-700 rounded-xl">
          <input
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="Column name"
            className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40"
          />
          <select
            value={newColType}
            onChange={e => setNewColType(e.target.value as ColType)}
            className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none"
          >
            {(['text', 'number', 'date', 'checkbox', 'select', 'multiselect'] as ColType[]).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {(newColType === 'select' || newColType === 'multiselect') && (
            <input
              value={newColOptions}
              onChange={e => setNewColOptions(e.target.value)}
              placeholder="Options (comma-separated)"
              className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
            />
          )}
          <button type="submit" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded transition">Add</button>
          <button type="button" onClick={() => setShowAddCol(false)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sm rounded transition">Cancel</button>
        </form>
      )}

      <div className="flex-1 overflow-auto rounded-xl border border-slate-800">
        {columns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-sm gap-2">
            <p>No columns yet.</p>
            <button onClick={() => setShowAddCol(true)} className="text-indigo-400 hover:text-indigo-300 underline text-xs">Add your first column</button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80">
                {columns.map(col => (
                  <th key={col._id} className="text-left px-3 py-2 font-medium text-slate-400 whitespace-nowrap group min-w-[120px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-600 font-mono">{TYPE_BADGE[col.type]}</span>
                      <span>{col.name}</span>
                      <button
                        onClick={() => deleteColumn(col._id)}
                        className="opacity-0 group-hover:opacity-100 ml-auto text-slate-700 hover:text-red-400 text-xs transition leading-none"
                      >✕</button>
                    </div>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="text-center text-slate-600 text-sm py-10">
                    No rows yet — click + Row to add one.
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row._id} className="border-b border-slate-800/60 hover:bg-slate-900/40 group">
                  {columns.map(col => {
                    const isEditing = editing?.rowId === row._id && editing?.colId === col._id
                    const cellVal = row.cells[col._id]
                    return (
                      <td
                        key={col._id}
                        className="px-3 py-2 cursor-pointer min-w-[120px] max-w-[300px]"
                        onClick={() => {
                          if (col.type !== 'checkbox') setEditing({ rowId: row._id, colId: col._id })
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            col={col}
                            initial={cellVal}
                            onSave={v => saveCell(row._id, col._id, v)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : col.type === 'checkbox' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(cellVal)}
                            onChange={e => saveCell(row._id, col._id, e.target.checked)}
                            className="w-4 h-4 accent-indigo-500"
                          />
                        ) : (
                          <span className="text-slate-300 truncate block">
                            {formatCell(cellVal, col.type) || <span className="text-slate-700">—</span>}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 w-8">
                    <button
                      onClick={() => deleteRow(row._id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400 text-xs transition"
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <button
          onClick={addRow}
          className="text-xs px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition"
        >
          + Row
        </button>
      </div>
    </div>
  )

      {showDelete && (
        <ConfirmDeleteModal
          name={slug}
          type="table"
          onConfirm={deleteSpace}
          onCancel={() => setShowDelete(false)}
          deleting={deleting}
        />
      )}
}