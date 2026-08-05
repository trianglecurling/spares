/**
 * Tailwind config for article CSS generation.
 * Mirrors frontend tailwind.config.js so generated styles match the app.
 */
export const articleTailwindConfig = {
  darkMode: 'class' as const,
  theme: {
    extend: {
      colors: {
        primary: {
          dark: '#121033',
          orange: '#fa4c06',
          teal: '#01B9BC',
          'teal-solid': '#008485',
          /** Theme-aware; keep in sync with frontend/tailwind.config.js + index.css. */
          'teal-link': 'rgb(var(--color-primary-teal-link) / <alpha-value>)',
          'teal-on-tint': '#087c7f',
        },
      },
    },
  },
  plugins: [],
};
