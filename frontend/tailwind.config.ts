import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0f1117',
        panel:   '#1a1d27',
        border:  '#2a2d3a',
      },
    },
  },
  plugins: [],
} satisfies Config
