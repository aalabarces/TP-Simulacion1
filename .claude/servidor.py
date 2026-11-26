"""Servidor estático para probar el juego en el navegador (sin caché, así los cambios se ven al recargar)."""
import http.server
import socketserver
import sys

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


# Con hilos: el juego pide ~30 scripts a la vez, y dos copias abiertas juntas (el test de
# sincronización online, tests/lockstep.html) desbordaban la cola de un servidor de un solo hilo.
socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer(('', PUERTO), SinCache) as servidor:
    servidor.serve_forever()
