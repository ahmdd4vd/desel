#!/usr/bin/env python3
"""Durable, no-retry acceptance client. No credentials or request bodies in receipts.
Launch independently of a short command timeout; inspect status via status/recover.
Requires an already-authorized local bridge; never starts provider services.
"""
import argparse,hashlib,json,os,sqlite3,time,urllib.request,sys,subprocess,signal,threading
from pathlib import Path

def atomic(path,value):
 path=Path(path);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value));tmp.replace(path)
def recover(db,deck_id,dest):
 with sqlite3.connect(db) as c:
  row=c.execute('SELECT doc FROM decks WHERE id=?',(deck_id,)).fetchone()
 if not row:raise ValueError('Deck not found')
 d=json.loads(row[0]);atomic(dest,d);return hashlib.sha256(row[0].encode()).hexdigest()
def cleanup_services(pid_file):
 if not pid_file:return []
 stopped=[]
 for pid in json.loads(Path(pid_file).read_text()):
  if not isinstance(pid,int) or pid<=1 or pid==os.getpid():raise ValueError('Invalid owned service process group')
  try:os.killpg(pid,signal.SIGTERM);stopped.append(pid)
  except ProcessLookupError:pass
 return stopped

def run(args):
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True);receipt=out/'status.json'
 # A prior receipt, even failed/unknown, must be reconciled by a person.
 try:
  fd=os.open(str(out/'run.lock'),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
 except FileExistsError:raise RuntimeError('Run already exists; use status/recover, never replay')
 if receipt.exists():raise RuntimeError('Run already exists; use status/recover, never replay')
 state={'state':'running','pid':os.getpid(),'startedAt':time.time(),'deckId':args.deck_id,'automaticRetry':False,'deadlineAt':time.time()+args.deadline}
 atomic(receipt,state)
 settled=threading.Event()
 def supervise():
  # Wall-clock deadline is explicit in the receipt; don't depend solely on a
  # SIGALRM reaching the main thread while urllib is blocked in native I/O.
  while not settled.wait(.2):
   if time.time()>=state['deadlineAt']:
    expired=dict(state,state='uncertain',error='Overall deadline reached; remote completion unknown; do not replay',finishedAt=time.time())
    try:expired['persistedDeckSha256']=recover(args.db,args.deck_id,out/'recovered-deck.json')
    except Exception as e:expired['recoveryError']=str(e)
    try:expired['stoppedOwnedServiceGroups']=cleanup_services(args.owned_service_pids)
    except Exception as e:expired['cleanupError']=str(e)
    atomic(receipt,expired);os._exit(2)
 threading.Thread(target=supervise,daemon=True).start()
 def deadline(_signum,_frame):raise TimeoutError('Overall test deadline reached; completion uncertain, recover before continuing')
 previous=signal.signal(signal.SIGALRM,deadline);signal.alarm(args.deadline)
 try:
  with sqlite3.connect(args.db) as c:row=c.execute('SELECT doc FROM decks WHERE id=?',(args.deck_id,)).fetchone()
  if not row:raise ValueError('Deck not found')
  payload=json.dumps({'deck':json.loads(row[0]),'text':Path(args.prompt_file).read_text(), 'geometry':json.loads(Path(args.geometry_file).read_text()) if args.geometry_file else []}).encode()
  req=urllib.request.Request(args.endpoint,data=payload,headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=args.timeout) as response,open(out/'events.jsonl','a') as events:
   complete=False;run_error=False;done_reason=None
   for line in response:
    event=json.loads(line)
    if event.get('type')=='error':run_error=True;state['agentError']=event.get('message','Agent error (message unavailable)')
    if event.get('type')=='done':done_reason=event.get('reason')
    if 'bridge_deck' in event:
     atomic(out/'deck.json',event['bridge_deck']);complete=True
    # Do not retain reference bytes, transcripts or model text in summary log.
    events.write(json.dumps({k:event[k]for k in ['type','name','reason','turn','request_id','index','revision','message']if k in event})+'\n');events.flush();os.fsync(events.fileno())
    if event.get('type') in ['deck_updated','render_request'] and args.renderer_endpoint:
     rr=urllib.request.Request(args.renderer_endpoint,data=json.dumps(event).encode(),headers={'Content-Type':'application/json'});urllib.request.urlopen(rr,timeout=12).read()
    if event.get('type')=='render_request' and not args.renderer_endpoint:
     raise RuntimeError('Render requested without connected UI; durable state retained, no fabricated pixels')
   state.update(state=('incomplete' if run_error else 'review_required' if done_reason=='review_required' else 'complete' if complete and done_reason else 'uncertain'),transportRecovered=complete,doneReason=done_reason,finishedAt=time.time())
 except Exception as e:state.update(state='uncertain',error=str(e),finishedAt=time.time())
 finally:
  settled.set()
  signal.alarm(0);signal.signal(signal.SIGALRM,previous)
  try:state['persistedDeckSha256']=recover(args.db,args.deck_id,out/'recovered-deck.json')
  except Exception as e:state['recoveryError']=str(e)
  try:state['stoppedOwnedServiceGroups']=cleanup_services(args.owned_service_pids)
  except Exception as e:state['cleanupError']=str(e)
  atomic(receipt,state)
 return 0 if state['state']=='complete' else 2

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True)
 r=sub.add_parser('run');r.add_argument('--db',required=True);r.add_argument('--deck-id',required=True);r.add_argument('--prompt-file',required=True);r.add_argument('--output',required=True);r.add_argument('--endpoint',default='http://127.0.0.1:9798');r.add_argument('--timeout',type=int,default=420);r.add_argument('--deadline',type=int,default=900);r.add_argument('--owned-service-pids');r.add_argument('--geometry-file');r.add_argument('--renderer-endpoint')
 start=sub.add_parser('start',parents=[r],add_help=False);
 q=sub.add_parser('status');q.add_argument('--output',required=True)
 q=sub.add_parser('recover');q.add_argument('--db',required=True);q.add_argument('--deck-id',required=True);q.add_argument('--output',required=True)
 a=p.parse_args()
 if a.action=='start':
  out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
  if (out/'run.lock').exists() or (out/'launch.lock').exists() or (out/'status.json').exists():raise RuntimeError('Run exists; inspect status, do not replay')
  fd=os.open(str(out/'launch.lock'),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
  command=[sys.executable,str(Path(__file__).resolve()),'run','--db',a.db,'--deck-id',a.deck_id,'--prompt-file',a.prompt_file,'--output',a.output,'--endpoint',a.endpoint,'--timeout',str(a.timeout),'--deadline',str(a.deadline)]
  if a.renderer_endpoint:command+=['--renderer-endpoint',a.renderer_endpoint]
  if a.geometry_file:command+=['--geometry-file',a.geometry_file]
  if a.owned_service_pids:command+=['--owned-service-pids',a.owned_service_pids]
  with open(out/'worker.log','ab') as log:process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
  atomic(out/'launch.json',{'pid':process.pid,'automaticRetry':False,'startedAt':time.time()});print(json.dumps({'pid':process.pid,'output':str(out)}));return 0
 if a.action=='run':return run(a)
 if a.action=='status':
  value=json.loads((Path(a.output)/'status.json').read_text())
  try:os.kill(value.get('pid',0),0);alive=True
  except OSError:alive=False
  value['processAlive']=alive
  if value['state']=='running' and not alive:value['state']='uncertain'
  print(json.dumps(value));return 0
 print(recover(a.db,a.deck_id,a.output));return 0
if __name__=='__main__':sys.exit(main())
