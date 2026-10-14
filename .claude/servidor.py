"""Servidor estático para probar el juego en el navegador (sin caché, así los cambios se ven al recargar)."""
import http.server
import socketserver
import sys

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PUERTO), SinCache) as servidor:
    servidor.serve_forever()
