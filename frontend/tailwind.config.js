/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0A0B0E',
          panel: '#13151A',
          raised: '#1A1D24',
          hover: '#222630',
        },
        border: {
          subtle: 'rgba(255, 255, 255, 0.06)',
          hover: 'rgba(255, 255, 255, 0.12)',
        },
        accent: {
          start: '#8FD3FF',
          end: '#A9B8FF',
          primary: '#8FD3FF',
        },
        txt: {
          primary: '#E8EAF0',
          muted: '#8B90A0',
        },
        danger: '#FF6B6B',
        success: '#5BE3A0',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
