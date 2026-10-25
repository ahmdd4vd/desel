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
def call(o,url,data=None):return json.load(o.open(urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':url.split('/api')[0]}),timeout=90))
p=None
try:
 p,o,manager,gw=start();r=call(o,manager+'/api/provider/save',{'new':True,'name':'isolated-local','chat':f'http://127.0.0.1:{up.server_port}/v1','key':'fake-local-key','models':['local-test-model']});provider=next(x for x in r['providers'] if x['name']=='isolated-local');pid=provider['id'];mark('provider add',True)
 models=call(o,gw+'/models')['data'];model=next(x['id'] for x in models if 'local-test-model' in x['id']);mark('gateway model discovery',True,model)
 answer=call(o,gw+'/chat/completions',{'model':model,'messages':[{'role':'user','content':'local QA'}]});mark('local gateway inference',answer['choices'][0]['message']['content']=='local QA ok')
 try:call(o,gw+'/chat/completions',{'model':model,'messages':[{'role':'user','content':'fail'}]});mark('upstream auth failure surfaced',False)
 except urllib.error.HTTPError as e:mark('upstream auth failure surfaced',e.code>=400,str(e.code))
 second=call(o,manager+'/api/keys/add',{'id':pid,'name':'second-local','key':'fake-local-second'});row=next(x for x in second['providers'] if x['id']==pid);ref=next(x['id'] for x in row['keyList'] if x.get('name')=='second-local')
 for op in ['use','off','on','remove']:call(o,manager+'/api/keys/'+op,{'id':pid,'ref':ref});mark('account '+op,True)
 for path in ['/api/plugins','/api/plugins/updates']:
  call(o,manager+path);mark('read '+path,True)
 check=call(o,manager+'/api/plugins/check',{});mark('empty plugin update check',isinstance(check.get('plugins'),list))
 try:call(o,manager+'/api/plugin-signin',{'provider':'not-installed-qa','method':0,'inputs':{}});mark('missing plugin login fails',False)
 except urllib.error.HTTPError as e:mark('missing plugin login fails',e.code>=400,str(e.code))
 os.killpg(p.pid,signal.SIGTERM);p.wait();p=None;old=gw;p,o,manager,gw=start();r=call(o,manager+'/api/providers');mark('provider survives isolated restart',any(x['id']==pid for x in r['providers']));mark('ephemeral port changes',old!=gw)
 call(o,manager+'/api/provider/delete',{'id':pid});r=call(o,manager+'/api/providers');mark('provider delete persists',not any(x['id']==pid for x in r['providers']))
finally:
 if p:os.killpg(p.pid,signal.SIGTERM);p.wait()
 up.shutdown();shutil.rmtree(root);json.dump(results,open('/tmp/desel-integration-results.json','w'),indent=2)
