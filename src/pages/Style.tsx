/**
 * Hidden design-system page: /style
 * Shows current CSS styling — font families, sizes, weights, and colors.
 * Not linked in nav; reach via URL only.
 */

export default function Style() {
  const fontSizes = [
    { class: 'text-[10px]', label: '10px', note: 'Custom' },
    { class: 'text-xs', label: 'xs', note: '0.75rem / 12px' },
    { class: 'text-sm', label: 'sm', note: '0.875rem / 14px' },
    { class: 'text-base', label: 'base', note: '1rem / 16px' },
    { class: 'text-lg', label: 'lg', note: '1.125rem / 18px' },
    { class: 'text-xl', label: 'xl', note: '1.25rem / 20px' },
    { class: 'text-2xl', label: '2xl', note: '1.5rem / 24px' },
    { class: 'text-3xl', label: '3xl', note: '1.875rem / 30px' },
    { class: 'text-4xl', label: '4xl', note: '2.25rem / 36px' },
  ] as const

  const fontWeights = [
    { class: 'font-thin', label: 'thin', value: '100' },
    { class: 'font-extralight', label: 'extralight', value: '200' },
    { class: 'font-light', label: 'light', value: '300' },
    { class: 'font-normal', label: 'normal', value: '400' },
    { class: 'font-medium', label: 'medium', value: '500' },
    { class: 'font-semibold', label: 'semibold', value: '600' },
    { class: 'font-bold', label: 'bold', value: '700' },
    { class: 'font-extrabold', label: 'extrabold', value: '800' },
    { class: 'font-black', label: 'black', value: '900' },
  ] as const

  /* Tailwind JIT only includes classes that appear as full strings — no dynamic text-${c} */
  const slateSwatches = [
    { bg: 'bg-slate-50', text: 'text-slate-900', label: '50' },
    { bg: 'bg-slate-100', text: 'text-slate-900', label: '100' },
    { bg: 'bg-slate-200', text: 'text-slate-900', label: '200' },
    { bg: 'bg-slate-300', text: 'text-slate-900', label: '300' },
    { bg: 'bg-slate-400', text: 'text-slate-900', label: '400' },
    { bg: 'bg-slate-500', text: 'text-slate-100', label: '500' },
    { bg: 'bg-slate-600', text: 'text-slate-100', label: '600' },
    { bg: 'bg-slate-700', text: 'text-slate-100', label: '700' },
    { bg: 'bg-slate-800', text: 'text-slate-100', label: '800' },
    { bg: 'bg-slate-900', text: 'text-slate-100', label: '900' },
    { bg: 'bg-slate-950', text: 'text-slate-100', label: '950' },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Style guide</h1>
        <p className="text-sm text-slate-500">Font sizes, weights, and colors in use. Route: /style (hidden from nav).</p>
      </div>

      {/* Font families */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-700 pb-2">
          Font families
        </h2>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-slate-500 mb-1">font-sans (DM Sans) — body default</div>
            <p className="font-sans text-slate-100 text-base">
              The quick brown fox jumps over the lazy dog. 0123456789
            </p>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">font-mono</div>
            <p className="font-mono text-slate-100 text-sm">
              The quick brown fox jumps over the lazy dog. 0123456789
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Body base size in <code className="bg-slate-800 px-1 rounded">index.css</code>: 12pt.
          </p>
        </div>
      </section>

      {/* Font sizes */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-700 pb-2">
          Font sizes
        </h2>
        <div className="space-y-3">
          {fontSizes.map(({ class: sizeClass, label, note }) => (
            <div key={label} className="flex items-baseline gap-4 flex-wrap">
              <span className={`${sizeClass} text-slate-100`}>Sample {label}</span>
              <span className="text-xs text-slate-500 font-mono">{sizeClass}</span>
              <span className="text-xs text-slate-600">{note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Font weights */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-700 pb-2">
          Font weights
        </h2>
        <div className="space-y-2">
          {fontWeights.map(({ class: weightClass, label, value }) => (
            <div key={label} className="flex items-center gap-4 flex-wrap">
              <span className={`${weightClass} text-slate-100 text-base`}>Sample {label}</span>
              <span className="text-xs text-slate-500 font-mono">{weightClass}</span>
              <span className="text-xs text-slate-600">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Colors — all classes explicit so Tailwind JIT includes them */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3 border-b border-slate-700 pb-2">
          Colors
        </h2>

        <div className="mb-6">
          <div className="text-sm font-medium text-slate-400 mb-2">Slate (primary UI)</div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-11 gap-2">
            {slateSwatches.map(({ bg, text, label }) => (
              <div
                key={label}
                className={`${bg} rounded-lg border border-slate-700/50 flex flex-col items-center justify-center min-h-[3rem] px-2 py-2`}
              >
                <span className={`${text} text-xs font-medium`}>Aa</span>
                <span className="text-[10px] font-mono mt-0.5 opacity-80">slate-{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-sm font-medium text-slate-400 mb-2">Sky (brand/links)</div>
          <div className="flex flex-wrap gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700/50">
            <span className="text-sky-300 text-sm">text-sky-300</span>
            <span className="text-sky-400 text-sm">text-sky-400</span>
            <span className="text-sky-500 text-sm">text-sky-500</span>
            <span className="text-sky-600 text-sm">text-sky-600</span>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">Semantic (signals, alerts)</div>
          <div className="flex flex-wrap gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700/50">
            <span className="text-emerald-300 text-sm">text-emerald-300</span>
            <span className="text-emerald-400 text-sm">text-emerald-400</span>
            <span className="text-amber-300 text-sm">text-amber-300</span>
            <span className="text-amber-400 text-sm">text-amber-400</span>
            <span className="text-red-300 text-sm">text-red-300</span>
            <span className="text-red-400 text-sm">text-red-400</span>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-sm font-medium text-slate-400 mb-2">Text color tokens (on dark)</div>
          <div className="flex flex-wrap gap-2">
            <span className="text-slate-50 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-50</span>
            <span className="text-slate-100 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-100</span>
            <span className="text-slate-200 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-200</span>
            <span className="text-slate-300 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-300</span>
            <span className="text-slate-400 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-400</span>
            <span className="text-slate-500 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-slate-500</span>
            <span className="text-sky-400 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-sky-400</span>
            <span className="text-emerald-400 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-emerald-400</span>
            <span className="text-amber-400 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-amber-400</span>
            <span className="text-red-400 bg-slate-900 px-2 py-1 rounded text-xs border border-slate-700/50">text-red-400</span>
          </div>
        </div>
      </section>
    </div>
  )
}
