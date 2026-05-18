export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#0A0A0A',
          soft:    '#1F1F1F',
          mute:    '#737373',
          faint:   '#A3A3A3',
          line:    '#E5E5E5',
        },
        paper:   '#FFFFFF',
        surface: '#FAFAFA',
        accent: {
          DEFAULT: '#4F46E5',
          soft:    '#EEF2FF',
          ring:    '#C7D2FE',
        },
      },
      letterSpacing: {
        tightish: '-0.015em',
        tighter2: '-0.025em',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(10,10,10,0.04)',
        lift: '0 4px 14px rgba(10,10,10,0.08)',
      },
    },
  },
  plugins: [],
}
