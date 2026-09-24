import type { Config } from "tailwindcss";

// Calm, finance-grade palette (SPEC §9): ink on paper, one accent, a warning tone for risk copy. No neon.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#16202a", soft: "#4a5663", faint: "#8a95a1" },
        paper: { DEFAULT: "#f7f6f2", card: "#ffffff", line: "#e4e2dc" },
        accent: { DEFAULT: "#1f5f8b", soft: "#e6eef5" },
        gain: "#2f7d4f",
        loss: "#a8412f",
        caution: { DEFAULT: "#8a5a12", bg: "#fbf3e3", line: "#ecd9b0" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
