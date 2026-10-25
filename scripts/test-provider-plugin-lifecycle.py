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
 web,gw=port(),port();env={'PATH':os.environ['PATH'],'HOME':root,'XDG_CONFIG_HOME':root+'/config','XDG_DATA_HOME':root+'/data','XDG_CACHE_HOME':root+'/cache','MAGPIE_WEB_KEY':'qa-local-only-integration','MAGPIE_ADDR':f'127.0.0.1:{gw}'};p=subprocess.Popen([str(__import__('pathlib').Path(__file__).resolve().parents[1]/'src-tauri/binaries/magpie-linux-amd64'),'web','--no-open','--gateway','--addr',f'127.0.0.1:{web}'],env=env,stdout=subprocess.DEVNULL,stderr=open('/tmp/desel-integration-runtime.log','w'),start_new_session=True);o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 for _ in range(100):
  try:o.open(f'http://127.0.0.1:{web}/?k=qa-local-only-integration');break
  except:time.sleep(.1)
 return p,o,f'http://127.0.0.1:{web}',f'http://127.0.0.1:{gw}/v1'
def call(o,url,data=None):return json.load(o.open(urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':url.split('/api')[0]}),timeout=330))
p=None
try:
 p,o,manager,gw=start()
 fixture=root+'/fixture-plugin';os.makedirs(fixture)
 json.dump({'name':'desel-local-qa-plugin','version':'1.0.0','type':'module','main':'index.mjs'},open(fixture+'/package.json','w'))
 open(fixture+'/index.mjs','w').write('export default async()=>({})\n')
 before=call(o,manager+'/api/plugins');mark('initial plugin list empty',len(before['plugins'])==0)
 added=call(o,manager+'/api/plugins/add',{'spec':fixture});mark('authored inert local plugin add',any(x['spec']==fixture for x in added['plugins']))
 for off in [True,False]:
  r=call(o,manager+'/api/plugins/off',{'spec':fixture,'off':off});mark('plugin '+('disable' if off else 'enable'),any(x['spec']==fixture and x.get('off',False)==off for x in r['plugins']))
 check=call(o,manager+'/api/plugins/check',{});mark('local plugin update check',any(x.get('status')=='folder' for x in check['plugins']))
 os.killpg(p.pid,signal.SIGTERM);p.wait();p=None;p,o,manager,gw=start();r=call(o,manager+'/api/plugins');mark('local plugin survives restart',any(x['spec']==fixture for x in r['plugins']))
 removed=call(o,manager+'/api/plugins/remove',{'spec':fixture});mark('local plugin remove',not any(x['spec']==fixture for x in removed['plugins']))

finally:
 if p:os.killpg(p.pid,signal.SIGTERM);p.wait()
 up.shutdown();shutil.rmtree(root);json.dump(results,open('/tmp/desel-plugin-results.json','w'),indent=2)
