import unittest,tempfile,sqlite3,json,threading,subprocess,sys,time,os,signal
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
RUNNER=Path(__file__).with_name('runner.py')
class Tests(unittest.TestCase):
 def test_complete_unknown_and_no_replay(self):
  with tempfile.TemporaryDirectory() as td:
   td=Path(td);db=td/'test.db';c=sqlite3.connect(db);c.execute('create table decks(id text,doc text)');c.execute('insert into decks values(?,?)',('d',json.dumps({'id':'d','slides':[]})));c.commit();c.close();prompt=td/'prompt.txt';prompt.write_text('fixture');requests=[]
   class H(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def do_POST(self):
     requests.append(1);self.rfile.read(int(self.headers['Content-Length']));self.send_response(200);self.end_headers();self.wfile.write((json.dumps({'type':'done','reason':'complete'})+'\n'+json.dumps({'bridge_deck':{'id':'d','slides':[]}})+'\n').encode())
   server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start();base=[sys.executable,str(RUNNER),'run','--db',str(db),'--deck-id','d','--prompt-file',str(prompt),'--endpoint',f'http://127.0.0.1:{server.server_port}','--output',str(td/'run')]
   self.assertEqual(subprocess.run(base,capture_output=True).returncode,0);state=json.loads((td/'run/status.json').read_text());self.assertEqual(state['state'],'complete');self.assertTrue((td/'run/recovered-deck.json').exists());self.assertNotEqual(subprocess.run(base,capture_output=True).returncode,0);self.assertEqual(len(requests),1)
   class E(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def do_POST(self):
     self.rfile.read(int(self.headers['Content-Length']));self.send_response(200);self.end_headers();self.wfile.write((json.dumps({'type':'error','message':'fixture rejected'})+'\n'+json.dumps({'bridge_deck':{'id':'d','slides':[]}})+'\n').encode())
   es=ThreadingHTTPServer(('127.0.0.1',0),E);threading.Thread(target=es.serve_forever,daemon=True).start()
   eb=base.copy();eb[eb.index('--endpoint')+1]=f'http://127.0.0.1:{es.server_port}';eb[eb.index('--output')+1]=str(td/'error')
   self.assertEqual(subprocess.run(eb,capture_output=True).returncode,2);ev=json.loads((td/'error/status.json').read_text());self.assertEqual(ev['state'],'incomplete');self.assertTrue(ev['transportRecovered']);self.assertEqual(ev['agentError'],'fixture rejected');es.shutdown()
   # An interrupted run is reported uncertain, never silently retried.
   state.update(state='running',pid=99999999);(td/'run/status.json').write_text(json.dumps(state));result=subprocess.check_output([sys.executable,str(RUNNER),'status','--output',str(td/'run')]);self.assertEqual(json.loads(result)['state'],'uncertain');self.assertEqual(len(requests),1)
   # Detached start has a durable receipt and still refuses duplicate launch.
   detached=base.copy();detached[2]='start';detached[-1]=str(td/'detached')
   launch=subprocess.run(detached,capture_output=True);self.assertEqual(launch.returncode,0,launch.stderr)
   for _ in range(100):
    status=td/'detached/status.json'
    if status.exists() and json.loads(status.read_text()).get('state')=='complete':break
    time.sleep(.02)
   self.assertEqual(json.loads(status.read_text())['state'],'complete');self.assertNotEqual(subprocess.run(detached,capture_output=True).returncode,0);self.assertEqual(len(requests),2)
   class Slow(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def do_POST(self):
     self.rfile.read(int(self.headers['Content-Length']));time.sleep(2)
     try:self.send_response(200);self.end_headers()
     except (BrokenPipeError,ConnectionResetError):pass
   slow=ThreadingHTTPServer(('127.0.0.1',0),Slow);threading.Thread(target=slow.serve_forever,daemon=True).start()
   uncertain=base.copy();uncertain[uncertain.index('--endpoint')+1]=f'http://127.0.0.1:{slow.server_port}';uncertain[-1]=str(td/'deadline');uncertain+=['--deadline','1']
   self.assertEqual(subprocess.run(uncertain,capture_output=True).returncode,2);state=json.loads((td/'deadline/status.json').read_text());self.assertEqual(state['state'],'uncertain');self.assertIn('deadline',state['error']);self.assertTrue((td/'deadline/recovered-deck.json').exists());slow.shutdown();slow.server_close()
   # Deadline supervisor still settles when the main Python signal handler is unavailable.
   service=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
   pidfile=td/'owned.json';pidfile.write_text(json.dumps([service.pid]))
   watchdog=uncertain.copy();watchdog[watchdog.index('--output')+1]=str(td/'watchdog');watchdog+=['--owned-service-pids',str(pidfile)]
   # Invoke run with SIGALRM blocked to exercise the independent wall-clock watchdog.
   wrapper='import signal,runpy,sys;signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGALRM});sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name="__main__")'
   result=subprocess.run([sys.executable,'-c',wrapper]+watchdog[1:],capture_output=True,timeout=5)
   self.assertEqual(result.returncode,2,result.stderr);state=json.loads((td/'watchdog/status.json').read_text());self.assertEqual(state['state'],'uncertain');self.assertIn(service.pid,state['stoppedOwnedServiceGroups']);service.wait(timeout=3)
   server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
