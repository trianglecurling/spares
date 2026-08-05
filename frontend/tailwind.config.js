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
          /** Brand teal for borders, tints, icons, and decorative accents. */
          teal: '#01B9BC',
          /** Solid fills behind white text (buttons, avatars): meets WCAG AA 4.5:1. */
          'teal-solid': '#008485',
          /**
           * Inline links. Theme-aware via --color-primary-teal-link in index.css:
           * light #088487 (AA on white), dark #01B9BC (AA on gray-900).
           */
          'teal-link': 'rgb(var(--color-primary-teal-link) / <alpha-value>)',
          /** Accent text on primary-teal/10 tinted backgrounds: meets WCAG AA 4.5:1. */
          'teal-on-tint': '#087c7f',
        },
      },
    },
  },
  plugins: [],
};

