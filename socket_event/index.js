import registerStudentEvents from "./student.js"
import registerHrEvents from "./hr.js"
import registerInterviewerEvents from "./interviewer.js"

const handlersByRole = {
  student: registerStudentEvents,
  hr: registerHrEvents,
  interviewer: registerInterviewerEvents,
}

export default (io, socket) => {
  const { role } = socket.data.user
  console.log(`socket.io - connection (${role}:${socket.data.user.id})`)

  const register = handlersByRole[role]
  if (!register) {
    socket.disconnect(true)
    return
  }
  register(io, socket)

  socket.on("disconnect", () => {
    console.log(`socket.io - socket.id \`${socket.id}\` disconnected`)
  })
}
