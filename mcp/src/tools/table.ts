import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, put, patch, del } from '../client.js'

interface Column { _id: string; name: string; type: string; options: string[] }
interface Row { _id: string; cells: Record<string, unknown>; position: number }

async function fetchTable(slug: string) {
  const res = await get(`/api/table/${slug}`) as { data: { columns: Column[]; rows: Row[] } }
  return res.data
}

// Remap row cells from {colId: val} → {colName: val} for human-readable output
function denormalize(rows: Row[], columns: Column[]): Array<{ _id: string; position: number; cells: Record<string, unknown> }> {
  const idToName = Object.fromEntries(columns.map(c => [c._id, c.name]))
  return rows.map(row => ({
    _id: row._id,
    position: row.position,
    cells: Object.fromEntries(
      Object.entries(row.cells).map(([k, v]) => [idToName[k] ?? k, v])
    ),
  }))
}

// Resolve column names → IDs for writes
function resolveColIds(
  cells: Record<string, unknown>,
  columns: Column[],
): Record<string, unknown> {
  const nameToId = Object.fromEntries(columns.map(c => [c.name, c._id]))
  return Object.fromEntries(
    Object.entries(cells).map(([k, v]) => [nameToId[k] ?? k, v])
  )
}

export function registerTableTools(server: McpServer) {
  // Whole table
  server.tool(
    'aha_table_rows',
    'Read all rows from a Table space. Cells are keyed by column name. Optionally filter by a column value.',
    {
      slug: z.string().describe('Table slug'),
      filter_col: z.string().optional().describe('Column name to filter on'),
      filter_val: z.string().optional().describe('Value to match (string equality)'),
    },
    async ({ slug, filter_col, filter_val }) => {
      const { columns, rows } = await fetchTable(slug)
      let result = denormalize(rows, columns)

      if (filter_col && filter_val !== undefined) {
        result = result.filter(r => String(r.cells[filter_col] ?? '') === filter_val)
      }

      return { content: [{ type: 'text', text: JSON.stringify({ columns: columns.map(c => ({ id: c._id, name: c.name, type: c.type, options: c.options })), rows: result }, null, 2) }] }
    },
  )

  // Single cell
  server.tool(
    'aha_table_get_cell',
    'Read the value of a single cell by row ID and column name',
    {
      slug: z.string().describe('Table slug'),
      row_id: z.string().describe('Row ID'),
      col_name: z.string().describe('Column name'),
    },
    async ({ slug, row_id, col_name }) => {
      const { columns, rows } = await fetchTable(slug)
      const col = columns.find(c => c.name === col_name)
      if (!col) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column "${col_name}" not found` }) }] }
      const row = rows.find(r => r._id === row_id)
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ error: `Row "${row_id}" not found` }) }] }
      return { content: [{ type: 'text', text: JSON.stringify({ row_id, col_name, value: row.cells[col._id] ?? null }, null, 2) }] }
    },
  )

  // Schema only
  server.tool(
    'aha_table_schema',
    'Get the column schema for a Table space — names, types, and select options',
    { slug: z.string().describe('Table slug') },
    async ({ slug }) => {
      const { columns } = await fetchTable(slug)
      return { content: [{ type: 'text', text: JSON.stringify({ data: columns }, null, 2) }] }
    },
  )

  // Add column
  server.tool(
    'aha_table_add_column',
    'Add a new column to a Table space',
    {
      slug: z.string().describe('Table slug'),
      name: z.string().min(1).max(100).describe('Column name'),
      type: z.enum(['text', 'number', 'date', 'checkbox', 'select', 'multiselect']).optional().describe('Column type (default: text)'),
      options: z.array(z.string()).optional().describe('Options list for select or multiselect columns'),
    },
    async ({ slug, ...body }) => {
      const data = await post(`/api/table/${slug}/columns`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // Add row — accepts column names
  server.tool(
    'aha_table_add_row',
    'Add a new row. Pass cells keyed by column name (e.g. {"Status": "Done", "Priority": "High"}).',
    {
      slug: z.string().describe('Table slug'),
      cells: z.record(z.unknown()).optional().describe('Cell values keyed by column name'),
    },
    async ({ slug, cells = {} }) => {
      const { columns } = await fetchTable(slug)
      const data = await post(`/api/table/${slug}/rows`, { cells: resolveColIds(cells, columns) })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // Update row — accepts column names, only touches provided cells
  server.tool(
    'aha_table_update_row',
    'Update one or more cells in a row. Pass cells keyed by column name. Only provided cells are changed.',
    {
      slug: z.string().describe('Table slug'),
      id: z.string().describe('Row ID'),
      cells: z.record(z.unknown()).describe('Cells to update, keyed by column name'),
    },
    async ({ slug, id, cells }) => {
      const { columns } = await fetchTable(slug)
      const data = await patch(`/api/table/${slug}/rows/${id}`, { cells: resolveColIds(cells, columns) })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // Set single cell by column name
  server.tool(
    'aha_table_set_cell',
    'Set the value of a single cell, addressed by row ID and column name',
    {
      slug: z.string().describe('Table slug'),
      row_id: z.string().describe('Row ID'),
      col_name: z.string().describe('Column name'),
      value: z.unknown().describe('Value to set'),
    },
    async ({ slug, row_id, col_name, value }) => {
      const { columns } = await fetchTable(slug)
      const col = columns.find(c => c.name === col_name)
      if (!col) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column "${col_name}" not found` }) }] }
      const data = await put(`/api/table/${slug}/rows/${row_id}/cells/${col._id}`, { value })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // Clear single cell
  server.tool(
    'aha_table_clear_cell',
    'Clear (delete) the value of a single cell, addressed by row ID and column name',
    {
      slug: z.string().describe('Table slug'),
      row_id: z.string().describe('Row ID'),
      col_name: z.string().describe('Column name'),
    },
    async ({ slug, row_id, col_name }) => {
      const { columns } = await fetchTable(slug)
      const col = columns.find(c => c.name === col_name)
      if (!col) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column "${col_name}" not found` }) }] }
      const data = await del(`/api/table/${slug}/rows/${row_id}/cells/${col._id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // Delete row
  server.tool(
    'aha_table_delete_row',
    'Soft-delete a row from a Table space',
    {
      slug: z.string().describe('Table slug'),
      id: z.string().describe('Row ID'),
    },
    async ({ slug, id }) => {
      const data = await del(`/api/table/${slug}/rows/${id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
