/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Orbitron"', 'monospace'],
        body: ['"Share Tech Mono"', 'monospace'],
        ui: ['"Exo 2"', 'sans-serif'],
      },
      colors: {
        // Crisis command palette
        void: '#030712',
        panel: '#0a1628',
        surface: '#0f1f3d',
        border: '#1a3a5c',
        accent: '#00d4ff',
        accentDim: '#0099bb',
        warn: '#ff8c00',
        danger: '#ff2d55',
        success: '#00ff8c',
        ghost: '#1a3a5c80',
        text: '#c8dff5',
        textDim: '#6b8fb5',
        textMute: '#3a5a7c',
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 212, 255, 0.3)',
        glowWarn: '0 0 20px rgba(255, 140, 0, 0.4)',
        glowDanger: '0 0 20px rgba(255, 45, 85, 0.4)',
        panel: '0 4px 24px rgba(0,0,0,0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 8s linear infinite',
        'radar': 'radarSweep 4s linear infinite',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        radarSweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
