import { memo } from 'react'

interface SortHeaderProps {
  col: string
  label: string
  sortColumn: string
  sortDir: 'asc' | 'desc'
  onSort: (col: string) => void
  alignRight?: boolean
  sticky?: boolean
  stickyLeft?: string
}

function SortHeader({ col, label, sortColumn, sortDir, onSort, alignRight, sticky, stickyLeft }: SortHeaderProps) {
  const leftClass = sticky && stickyLeft === '0' ? 'left-0' : sticky && stickyLeft === '10rem' ? 'left-[10rem]' : ''
  return (
    <th
      className={`px-4 py-3 text-slate-300 font-medium cursor-pointer hover:text-slate-100 select-none whitespace-nowrap ${alignRight ? 'text-right' : ''} sticky top-0 z-[25] bg-slate-900 ${sticky ? `shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] ${leftClass}` : ''}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
        {label}
        {sortColumn === col && <span className="text-sky-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

export default memo(SortHeader)
