/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './index.{js,jsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        folio: {
          bg:       '#0F0E0C',
          card:     '#1A1916',
          elevated: '#242220',
          accent:   '#E8A838',
          text:     '#F0EBE1',
          muted:    '#8A8070',
          light:    '#C8BFB0',
          border:   '#2E2C28',
          success:  '#5DBB8A',
          error:    '#E85858',
        },
      },
    },
  },
  plugins: [],
}