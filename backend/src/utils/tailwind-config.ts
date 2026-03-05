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
        },
      },
    },
  },
  plugins: [],
};
