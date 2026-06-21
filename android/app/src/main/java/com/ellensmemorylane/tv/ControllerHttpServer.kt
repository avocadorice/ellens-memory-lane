package com.ellensmemorylane.tv

import android.content.res.AssetManager
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket

/**
 * Minimal zero-dependency static file server that hands the phone the controller
 * web app from the APK's assets/controller/ folder. The phone loads this over
 * http:// so its page can legally open a ws:// to the TV (an https:// page can't —
 * mixed-content rules would block the local WebSocket).
 *
 * Only GET is supported and only a small allow-list of files is served.
 */
class ControllerHttpServer(
    private val port: Int,
    private val assets: AssetManager,
) {
    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    private val mimeTypes = mapOf(
        "html" to "text/html; charset=utf-8",
        "js" to "application/javascript; charset=utf-8",
        "css" to "text/css; charset=utf-8",
    )

    fun start() {
        if (running) return
        running = true
        Thread {
            try {
                val socket = ServerSocket(port)
                socket.reuseAddress = true
                serverSocket = socket
                while (running) {
                    val client = try { socket.accept() } catch (e: Exception) { break }
                    // One short-lived thread per request — traffic is trivial.
                    Thread { handle(client) }.apply { isDaemon = true }.start()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.apply { isDaemon = true }.start()
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
    }

    private fun handle(client: Socket) {
        client.use {
            try {
                val reader = BufferedReader(InputStreamReader(client.getInputStream()))
                val requestLine = reader.readLine() ?: return
                // e.g. "GET /controller.js HTTP/1.1"
                val parts = requestLine.split(" ")
                if (parts.size < 2 || parts[0] != "GET") {
                    writeStatus(client.getOutputStream(), "405 Method Not Allowed")
                    return
                }
                var path = parts[1].substringBefore('?')
                if (path == "/") path = "/controller.html"

                // Resolve against the allow-list; reject anything path-traversal-y.
                val name = path.trimStart('/')
                if (name.contains("..") || name !in ALLOWED) {
                    writeStatus(client.getOutputStream(), "404 Not Found")
                    return
                }

                val bytes = assets.open("controller/$name").use { it.readBytes() }
                val ext = name.substringAfterLast('.', "")
                val mime = mimeTypes[ext] ?: "application/octet-stream"
                val out = client.getOutputStream()
                val header = buildString {
                    append("HTTP/1.1 200 OK\r\n")
                    append("Content-Type: $mime\r\n")
                    append("Content-Length: ${bytes.size}\r\n")
                    append("Cache-Control: no-store\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(header.toByteArray())
                out.write(bytes)
                out.flush()
            } catch (e: Exception) {
                try { writeStatus(client.getOutputStream(), "404 Not Found") } catch (_: Exception) {}
            }
        }
    }

    private fun writeStatus(out: OutputStream, status: String) {
        out.write(("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
        out.flush()
    }

    companion object {
        private val ALLOWED = setOf("controller.html", "controller.js", "controller.css")
    }
}
