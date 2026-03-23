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
  stickyTop?: boolean
}

function SortHeader({ col, label, sortColumn, sortDir, onSort, alignRight, sticky, stickyLeft, stickyTop = true }: SortHeaderProps) {
  const leftClass = sticky && stickyLeft === '0' ? 'left-0' : sticky && stickyLeft === '10rem' ? 'left-[10rem]' : ''
  const stickyTopClass = stickyTop ? 'sticky top-0 z-[25]' : ''
  const stickyLeftClass = sticky ? `sticky z-[26] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] ${leftClass}` : ''
  return (
    <th
      className={`px-4 py-3 text-sm text-slate-300 font-medium cursor-pointer hover:text-slate-100 select-none whitespace-nowrap bg-slate-900 ${alignRight ? 'text-right' : ''} ${stickyTopClass} ${stickyLeftClass}`}
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
