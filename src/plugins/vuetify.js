import "vuetify/styles"
import { createVuetify } from "vuetify"
import * as components from "vuetify/components"
import * as directives from "vuetify/directives"

const claudeTheme = {
  dark: false,
  colors: {
    primary: "#000000", // Simple black/dark grey for primary
    secondary: "#4b5563",
    accent: "#3b82f6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
    background: "#f9fafb",
    surface: "#ffffff",
  },
}

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: "claudeTheme",
    themes: { claudeTheme },
  },
})