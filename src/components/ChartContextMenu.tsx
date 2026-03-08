import { useEffect, useRef } from 'react'

interface MenuItem {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
}

interface ChartContextMenuProps {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ChartContextMenu({ open, x, y, items, onClose }: ChartContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Chart actions"
      className="fixed z-50 min-w-[200px] rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur"
      style={{ left: x, top: y }}
    >
      <div className="py-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-2 text-sm ${
              item.disabled
                ? 'text-slate-500 cursor-not-allowed'
                : 'text-slate-200 hover:bg-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
