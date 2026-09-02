import io from "socket.io-client"

class SocketManager {
  #instance

  connect(token) {
    if (this.#instance) this.#instance.disconnect()
    this.#instance = io({ auth: { token } })
    return this.#instance
  }

  getInstance() {
    if (!this.#instance) throw new Error("socket is not connected yet. call connect(token) first.")
    return this.#instance
  }

  disconnect() {
    this.#instance?.disconnect()
    this.#instance = null
  }
}

export default new SocketManager()
