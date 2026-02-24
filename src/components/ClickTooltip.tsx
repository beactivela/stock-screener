import { useState, useRef, useEffect } from 'react';

/** Click-to-show tooltip. Use `text` for plain string or `content` for JSX (e.g. bullet list). */
export function ClickTooltip({ text, content, children }: { text?: string; content?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-slate-600 hover:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-500 rounded"
        aria-label="Show explanation"
      >
        {children}
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 px-4 py-2.5 text-[10pt] text-slate-200 bg-slate-800 border border-slate-600 rounded-lg shadow-xl min-w-[320px] max-w-[380px] normal-case leading-relaxed"
          role="tooltip"
        >
          <div className="absolute left-1/2 -translate-x-1/2 top-0 -translate-y-full w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-slate-600" />
          {content ?? text}
        </div>
      )}
    </div>
  );
}
