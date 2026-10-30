import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0B2E59",
          700: "#123E73",
          900: "#061B36",
        },
        saffron: "#FF9933",
        indiaGreen: "#138808",
        canvas: "#F4F6FA",
        ink: {
          DEFAULT: "#12203A",
          soft: "#5A6B85",
          faint: "#8A99B0",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 40, 81, 0.04), 0 1px 3px rgba(16, 40, 81, 0.06)",
        pop: "0 10px 30px rgba(16, 40, 81, 0.12)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
