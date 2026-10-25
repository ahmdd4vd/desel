import unittest,tempfile,json,sqlite3,threading,subprocess,time,sys,os,signal
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import verified_start
class Test(unittest.TestCase):
 def test_no_provider_launch_on_any_failed_preflight(self):
  with tempfile.TemporaryDirectory()as td:
   td=Path(td);db=td/'d.db';deck={'id':'d','aspect':'4:5','slides':[{'id':'a','html':'cover'},{'id':'b','html':'body'}]}
   with sqlite3.connect(db)as c:c.executescript('create table decks(id text,doc text);create table assets(name text,data text);');c.execute('insert into decks values(?,?)',('d',json.dumps(deck)))
   state={'mode':'missing','provider':0}
   class H(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
     body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
     if self.path=='/provider':state['provider']+=1;self.send_response(200);self.end_headers();self.wfile.write((json.dumps({'type':'done','reason':'complete'})+'\n'+json.dumps({'bridge_deck':deck})+'\n').encode());return
     if body['type']=='render_request' and state['mode']!='missing':
      receipt={'revision':body['revision'],'issues':[],'accepted':True}
      if state['mode']=='stale':receipt['revision']='stale'
      if state['mode']=='error':receipt['error']='timeout'
      with sqlite3.connect(db)as c:
       c.execute('insert into assets values(?,?)',('__render_receipt_'+body['request_id'],json.dumps(receipt)))
       if state['mode']=='mutated':c.execute('update decks set doc=?',(json.dumps(dict(deck,title='oops')),))
     self.send_response(200);self.end_headers();self.wfile.write(b'{}')
   server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start();endpoint=f'http://127.0.0.1:{server.server_port}'
   prompt=td/'p';prompt.write_text('fixture')
   for mode in ['missing','stale','error','mutated']:
    state['mode']=mode
    with sqlite3.connect(db)as c:c.execute('update decks set doc=?',(json.dumps(deck),))
    service=subprocess.Popen(['sleep','60'],start_new_session=True);pids=td/'pids';pids.write_text(json.dumps([service.pid]));args=['--db',str(db),'--deck-id','d','--prompt-file',str(prompt),'--output',str(td/mode),'--endpoint',endpoint+'/provider']
    with self.assertRaises(Exception):verified_start.verified_start(str(db),'d',endpoint+'/renderer',str(pids),args)
    service.wait(timeout=2);self.assertEqual(state['provider'],0);self.assertFalse((td/mode/'launch.json').exists())
   server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
