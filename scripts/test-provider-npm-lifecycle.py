import io,tarfile,hashlib,base64,urllib.parse
import os,subprocess,tempfile,socket,time,json,urllib.request,http.cookiejar,threading,signal,shutil
from http.server import HTTPServer,BaseHTTPRequestHandler
results=[]
def mark(name,ok,detail=''):results.append({'test':name,'pass':bool(ok),'detail':detail});print(results[-1],flush=True)
def port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
class Upstream(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):self.reply({'data':[{'id':'local-test-model','context_length':200000,'max_output_tokens':8192}]})
 def reply(self,data,status=200):
  b=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_POST(self):
  d=json.loads(self.rfile.read(int(self.headers['Content-Length'])));self.reply({'error':{'message':'intentional local upstream failure'}},401) if 'fail' in str(d) else self.reply({'id':'local','object':'chat.completion','model':'local-test-model','choices':[{'index':0,'message':{'role':'assistant','content':'local QA ok'},'finish_reason':'stop'}]})
up=HTTPServer(('127.0.0.1',0),Upstream);threading.Thread(target=up.serve_forever,daemon=True).start();root=tempfile.mkdtemp(prefix='desel-integration-');os.makedirs(root+'/config/magpie');json.dump({k:True for k in ['noAutoUpdate','noAutoDownload','noAccountDiscovery','noStats']},open(root+'/config/magpie/settings.json','w'))
def start():
 web,gw=port(),port();env={'PATH':os.environ['PATH'],'HOME':root,'XDG_CONFIG_HOME':root+'/config','XDG_DATA_HOME':root+'/data','XDG_CACHE_HOME':root+'/cache','MAGPIE_WEB_KEY':'qa-local-only-integration','MAGPIE_ADDR':f'127.0.0.1:{gw}','BUN_CONFIG_REGISTRY':f'http://127.0.0.1:{registry.server_port}/'};p=subprocess.Popen([str(__import__('pathlib').Path(__file__).resolve().parents[1]/'src-tauri/binaries/magpie-linux-amd64'),'web','--no-open','--gateway','--addr',f'127.0.0.1:{web}'],env=env,stdout=subprocess.DEVNULL,stderr=open('/tmp/desel-integration-runtime.log','w'),start_new_session=True);o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 for _ in range(100):
  try:o.open(f'http://127.0.0.1:{web}/?k=qa-local-only-integration');break
  except:time.sleep(.1)
 return p,o,f'http://127.0.0.1:{web}',f'http://127.0.0.1:{gw}/v1'
def call(o,url,data=None):return json.load(o.open(urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':url.split('/api')[0]}),timeout=330))
class Registry(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  name='@magpie-community/desel-qualification-fixture'
  if self.path.startswith('/tarballs/'):
   version=self.path.split('/')[-1].replace('.tgz','');body=tarball(version);self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
  versions={v:{'name':name,'version':v,'type':'module','main':'index.mjs','dist':{'tarball':f'http://127.0.0.1:{self.server.server_port}/tarballs/{v}.tgz','integrity':'sha512-'+base64.b64encode(hashlib.sha512(tarball(v)).digest()).decode()}} for v in ['1.0.0','1.0.1']}
  body=json.dumps({'name':name,'dist-tags':{'latest':'1.0.1'},'versions':versions}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
def tarball(v):
 b=io.BytesIO()
 with tarfile.open(fileobj=b,mode='w:gz') as t:
  for filename,content in [('package/package.json',json.dumps({'name':'@magpie-community/desel-qualification-fixture','version':v,'type':'module','main':'index.mjs'})),('package/index.mjs','export default async()=>({})\n')]:
   info=tarfile.TarInfo(filename);data=content.encode();info.size=len(data);t.addfile(info,io.BytesIO(data))
 return b.getvalue()
registry=HTTPServer(('127.0.0.1',0),Registry);threading.Thread(target=registry.serve_forever,daemon=True).start()
p=None
try:
 p,o,manager,gw=start()
 name='@magpie-community/desel-qualification-fixture'
 for spec in [name+'@1.0.0',name+'@1.0.1',name+'@latest',name+'@1.0.1']:
  r=call(o,manager+'/api/plugins/add',{'spec':spec});rows=r['plugins'];row=next(x for x in rows if x['spec']==spec);mark('npm add '+spec,row.get('version')==('1.0.0' if spec.endswith('1.0.0') else '1.0.1'),str(row.get('version')))
 mark('one entry after version policy changes',len(rows)==1)
 r=call(o,manager+'/api/plugins/remove',{'spec':name+'@1.0.1'});mark('npm plugin remove',len(r['plugins'])==0)

finally:
 if p:os.killpg(p.pid,signal.SIGTERM);p.wait()
 registry.shutdown();up.shutdown();shutil.rmtree(root);json.dump(results,open('/tmp/desel-npm-results.json','w'),indent=2)
