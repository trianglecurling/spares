/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          dark: '#121033',
          orange: '#fa4c06',
          teal: '#01B9BC',
          /** Inline links on white: slightly muted vs brand teal for contrast without too much weight. */
          'teal-link': '#0dabaf',
        },
      },
    },
  },
  plugins: [],
};

