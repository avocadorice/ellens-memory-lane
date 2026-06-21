package com.ellensmemorylane.tv

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress

/**
 * Tiny WebSocket server the paired phone connects to. It just relays connection
 * lifecycle + input messages up to MainActivity, which turns them into key events
 * inside the game's WebView. Adapted from the ChillStick controller prototype.
 */
class GamepadServer(port: Int, private val listener: ServerListener) :
    WebSocketServer(InetSocketAddress(port)) {

    interface ServerListener {
        fun onClientConnected(conn: WebSocket)
        fun onClientDisconnected(conn: WebSocket)
        fun onMessageReceived(conn: WebSocket, message: String)
    }

    init {
        // Don't keep the JVM/socket lingering on restart — lets re-launch rebind fast.
        isReuseAddr = true
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        listener.onClientConnected(conn)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        listener.onClientDisconnected(conn)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        listener.onMessageReceived(conn, message)
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        ex.printStackTrace()
    }

    override fun onStart() {
        // no-op
    }
}
