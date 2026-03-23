/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Match body (index.css): utilities like text-sm were ~14px via 0.875rem; use 12px for UI “body” text.
      fontSize: {
        sm: ['12px', { lineHeight: '1.25rem' }],
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
      keyframes: {
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '14%': { transform: 'scale(1.15)', opacity: '0.9' },
          '28%': { transform: 'scale(1)', opacity: '1' },
          '42%': { transform: 'scale(1.1)', opacity: '0.95' },
          '56%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        heartbeat: 'heartbeat 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
