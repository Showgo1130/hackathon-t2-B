import "vuetify/styles"
import { createVuetify } from "vuetify"
import * as components from "vuetify/components"
import * as directives from "vuetify/directives"

// 人事画面の配色に合わせた共通テーマ（3ロールで同じ見た目にする）
const appTheme = {
  dark: false,
  colors: {
    primary: "#1769ff",
    secondary: "#42506a",
    accent: "#1769ff",
    success: "#1a8a4c",
    warning: "#c2740a",
    error: "#c62828",
    info: "#1d63d1",
    background: "#f7f9fc",
    surface: "#ffffff",
  },
}

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: "appTheme",
    themes: { appTheme },
  },
  defaults: {
    VCard: { rounded: "lg" },
    VBtn: { rounded: "lg" },
  },
})
