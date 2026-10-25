#!/usr/bin/env python3
"""Fail-closed entrypoint: no model request before end-to-end receipt persistence.
Services must already be started with owned process groups. Failure stops all of
those groups. This script NEVER starts/retries provider work itself.
"""
import argparse,json,sqlite3,urllib.request,uuid,subprocess,sys,signal,os
from pathlib import Path

def cleanup(path):
 for pid in json.loads(Path(path).read_text()):
  if not isinstance(pid,int)or pid<=1 or pid==os.getpid():raise ValueError('invalid owned process group')
  try:os.killpg(pid,signal.SIGTERM)
  except ProcessLookupError:pass

def verified_start(db,deck_id,renderer,owned,runner_args):
 request_id='preflight_'+uuid.uuid4().hex
 name='__render_receipt_'+request_id
 try:
  with sqlite3.connect(db)as c:
   deck=json.loads(c.execute('select doc from decks where id=?',(deck_id,)).fetchone()[0])
  if len(deck['slides'])<2:raise ValueError('target slide2 missing')
  slide=deck['slides'][1]
  h=2166136261
  for b in (slide['id']+'\0'+deck['aspect']+'\0'+slide['html']).encode():h=((h^b)*16777619)&0xffffffff
  revision=f'{h:08x}'
  def post(event):
   req=urllib.request.Request(renderer,data=json.dumps(event).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=12)as response:
    if response.status!=200:raise RuntimeError('renderer response not200')
  post({'type':'deck_updated','deck':deck})
  post({'type':'render_request','request_id':request_id,'index':1,'revision':revision,'candidate':{'base':slide,'slide':slide,'aspect':deck['aspect']}})
  with sqlite3.connect(db)as c:
   row=c.execute('select data from assets where name=?',(name,)).fetchone()
   if not row:raise RuntimeError('renderer frontend responded, but backend receipt missing')
   receipt=json.loads(row[0])
   if receipt.get('revision')!=revision or receipt.get('error') or not isinstance(receipt.get('issues'),list)or not isinstance(receipt.get('accepted'),bool):raise RuntimeError('invalid/unready candidate receipt')
   current=json.loads(c.execute('select doc from decks where id=?',(deck_id,)).fetchone()[0])
   if current!=deck:raise RuntimeError('preflight modified deck')
   c.execute('delete from assets where name=?',(name,));c.commit()
  # Sole launch boundary. Every readiness/assertion failure exits before here.
  return subprocess.run([sys.executable,str(Path(__file__).with_name('runner.py')),'start',*runner_args],check=True).returncode
 except Exception:
  cleanup(owned)
  raise
 finally:
  with sqlite3.connect(db)as c:c.execute('delete from assets where name=?',(name,));c.commit()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--deck-id',required=True);p.add_argument('--renderer',required=True);p.add_argument('--owned-service-pids',required=True);p.add_argument('runner_args',nargs=argparse.REMAINDER);a=p.parse_args();args=a.runner_args[1:]if a.runner_args[:1]==['--']else a.runner_args
 sys.exit(verified_start(a.db,a.deck_id,a.renderer,a.owned_service_pids,args))
