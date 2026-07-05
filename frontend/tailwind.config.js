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
          /** Inline links on white: brightest teal that meets WCAG AA 4.5:1. */
          'teal-link': '#088487',
          /** Accent text on primary-teal/10 tinted backgrounds: meets WCAG AA 4.5:1. */
          'teal-on-tint': '#087c7f',
        },
      },
    },
  },
  plugins: [],
};

