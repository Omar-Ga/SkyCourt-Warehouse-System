/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Cairo', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Official SkyCourt Brand Core
        brand: {
          violet: '#4B1E78', // Royal Violet - Official Primary & Dominant CTAs
          magenta: '#E40078', // Vibrant Magenta - Top Petal Accent
          lime: '#44B935',    // Summer Lime - Bottom Petal Accent
          teal: '#244B74',    // Official Gradient Bridge
          marine: '#2D8F55',  // Marine Green
        },
        // Operational Foundations (High-Contrast, Glare-Resistant)
        ink: {
          950: '#102A3A', // Primary body text, dark sidebar, dominant ink
          900: '#163345',
          800: '#1C3B4E',
          700: '#284C62',
          600: '#3F5C71',
          500: '#5B6670', // Secondary text, metadata labels
          400: '#8E9CA6',
          300: '#CBD5E1',
          200: '#E2E8F0', // Structural borders
          100: '#F1F5F9',
          50: '#F8FAFC',
        },
        coast: {
          950: '#0D2B44',
          900: '#123B5D', // Coastal blue primary action
          800: '#144A75',
          700: '#075E8C', // Text-safe informational blue
          600: '#0A74B0',
          500: '#1B8ED0',
          200: '#BAE6FD',
          100: '#E8F3F7', // Informational / selected tint
          50: '#F0F9FF',
        },
        surface: {
          canvas: '#F5F8F7', // Main app background
          card: '#FFFFFF',   // Card & modal background
          subtle: '#F8FAFC',
          border: '#E2E8F0', // Crisp 1px borders
          hover: '#F1F5F9',
        },
        // Calibrated Operational Status Colors (AA/AAA contrast)
        status: {
          success: '#146C43',
          'success-bg': '#E7F4EC',
          warning: '#7A4A00',
          'warning-bg': '#FFF1CC',
          danger: '#A61B29',
          'danger-bg': '#FBEAEC',
          info: '#075E8C',
          'info-bg': '#E8F3F7',
        },
        // Solid Legacy Class Mappings (Fixes transparent alpha bug)
        primary: {
          50: '#F4F0F9',
          100: '#E8DEF3',
          200: '#D3BFE8',
          300: '#B491D6',
          400: '#8E5FC0',
          500: '#6B35A3',
          600: '#4B1E78', // Royal Violet brand primary
          700: '#3E1864',
          800: '#311350',
          900: '#102A3A', // Deep coastal navy
        },
        secondary: {
          50: '#F0FAF9',
          100: '#CCF0EC',
          200: '#99E1D9',
          300: '#66D2C6',
          400: '#33C3B3',
          500: '#006B73',
          600: '#00575E',
          700: '#004349',
          800: '#003034',
          900: '#001D20',
        },
        accent: {
          50: '#FFF5F0',
          100: '#FFE4D6',
          200: '#FFC4A8',
          300: '#FFA075',
          400: '#FF7A42',
          500: '#E8871E',
          600: '#D47513',
          700: '#B55E0A',
          800: '#8A4404',
          900: '#5C2B01',
        },
        success: {
          50: '#E7F4EC',
          100: '#CFEAD9',
          200: '#A3D6B5',
          300: '#73BF8F',
          400: '#43A769',
          500: '#146C43',
          600: '#105836',
          700: '#0C4329',
          800: '#082F1D',
          900: '#041B10',
        },
        warning: {
          50: '#FFF9E6',
          100: '#FFF1CC',
          200: '#FFE199',
          300: '#FFCE66',
          400: '#FFB833',
          500: '#F2A33A',
          600: '#D98A20',
          700: '#7A4A00',
          800: '#5A3500',
          900: '#3D2200',
        },
        error: {
          50: '#FBEAEC',
          100: '#F7D2D6',
          200: '#EEA2AA',
          300: '#E36E7B',
          400: '#D43C4E',
          500: '#A61B29',
          600: '#8F1622',
          700: '#74111B',
          800: '#570C13',
          900: '#3B070C',
        },
        gray: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'scale-in': 'scaleIn 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};