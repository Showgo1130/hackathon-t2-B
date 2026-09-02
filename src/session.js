import { ref } from "vue"

const STORAGE_KEY = "interview-app-session"

const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export const session = ref(load())

export const setSession = (data) => {
  session.value = data
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const clearSession = () => {
  session.value = null
  sessionStorage.removeItem(STORAGE_KEY)
}
