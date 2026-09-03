import { createRouter, createWebHistory } from "vue-router"
import Login from "../components/Login.vue"
import StudentChat from "../components/student/StudentChat.vue"
import HrRecruitmentApp from "../components/hr/HrRecruitmentApp.vue"
import HrChatPage from "../components/hr/HrChatPage.vue"
import HrDashboardPage from "../components/hr/HrDashboardPage.vue"
import HrChatRoomsPage from "../components/hr/HrChatRoomsPage.vue"
import HrScheduleCreatePage from "../components/hr/HrScheduleCreatePage.vue"
import HrUserManagementPage from "../components/hr/HrUserManagementPage.vue"
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
      component: HrRecruitmentApp,
      beforeEnter: requireRole("hr"),
      children: [
        {
          path: "",
          name: "hr",
          redirect: { name: "hr-dashboard" },
        },
        {
          path: "dashboard",
          name: "hr-dashboard",
          component: HrDashboardPage,
        },
        {
          path: "chat",
          name: "hr-chat",
          component: HrChatRoomsPage,
        },
        {
          path: "chat/:role/:id",
          name: "hr-chat-room",
          component: HrChatPage,
        },
        {
          path: "schedules/new",
          name: "hr-schedule-create",
          component: HrScheduleCreatePage,
        },
        {
          path: "users",
          name: "hr-users",
          component: HrUserManagementPage,
        },
      ],
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
