/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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

