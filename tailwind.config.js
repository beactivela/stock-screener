/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Minimum readable size 14px (body in index.css). Replaces default xs/sm that were smaller.
      fontSize: {
        xs: ['14px', { lineHeight: '1.25rem' }],
        sm: ['14px', { lineHeight: '1.375rem' }],
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
