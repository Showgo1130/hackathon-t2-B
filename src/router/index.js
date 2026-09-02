import { createRouter, createWebHistory } from "vue-router"
import Login from "../components/Login.vue"
import StudentChat from "../components/student/StudentChat.vue"
import HrDashboard from "../components/hr/HrDashboard.vue"
import InterviewerHome from "../components/interviewer/InterviewerHome.vue"
import { session } from "../session.js"

const requireRole = (role) => (to, from, next) => {
  if (session.value?.role === role) {
    next()
  } else {
    next({ name: "login" })
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "login",
      component: Login,
    },
    {
      path: "/student",
      name: "student",
      component: StudentChat,
      beforeEnter: requireRole("student"),
    },
    {
      path: "/hr",
      name: "hr",
      component: HrDashboard,
      beforeEnter: requireRole("hr"),
    },
    {
      path: "/interviewer",
      name: "interviewer",
      component: InterviewerHome,
      beforeEnter: requireRole("interviewer"),
    },
  ],
})

export default router
