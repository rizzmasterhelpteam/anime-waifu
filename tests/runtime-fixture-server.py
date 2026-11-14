from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import time
P=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(P),**kwargs)
 def do_GET(self):
  if self.path.startswith('/__qa/'):
   if self.path.startswith('/__qa/slow-image'):
    time.sleep(10);self.send_response(204);self.end_headers();return
   html='<!doctype html><html><head><title>Companion test</title></head><body><h1>Extension test page</h1><p>Local test surface</p><input placeholder="Type here"><div id="content">Page content</div>'
   if 'slow' in self.path:html+='<img src="/__qa/slow-image">'
   html+='</body></html>';data=html.encode();self.send_response(200)
   if 'strict' in self.path:self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'none'; img-src 'none'; style-src 'unsafe-inline'; connect-src 'none'")
   self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  else:super().do_GET()
 def log_message(self,*args):pass
ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
