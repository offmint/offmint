import type { Config } from "tailwindcss";

// Offmint brand (docs/BRAND.md). Teal/cyan are for brand + interactive elements only; gains/losses in data use a
// neutral treatment so brand color is never read as "profit".
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tide: { DEFAULT: "#0E9F9A", dark: "#0B807C" }, // primary on light
        glow: "#3BE3EE", // primary on dark, the premium-gap shade on charts
        matte: "#161819", // dark surfaces, text on light
        graphite: "#2B2F31", // borders/surfaces on dark
        mist: "#EEF4F3", // light background
        // semantic aliases used across the app
        ink: { DEFAULT: "#161819", soft: "#4B5356", faint: "#8A9396" },
        paper: { DEFAULT: "#EEF4F3", card: "#FFFFFF", line: "#DCE5E3", text: "#F4F7F7" },
        accent: { DEFAULT: "#0E9F9A", soft: "#E1F2F1" },
        gain: "#2B2F31", // neutral: signs and arrows carry direction, not color
        loss: "#8C3B2E", // muted brick, for losses and errors only
        caution: { DEFAULT: "#6E4B12", bg: "#F7F1E4", line: "#E6D6B2" },
      },
      fontFamily: {
        sans: ["var(--font-schibsted)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
