from pathlib import Path
import subprocess,json,hashlib,time,urllib.request,urllib.error,os,http.client
base=Path('tests/browser/artifacts/agent-native-test');base.mkdir(parents=True,exist_ok=True);state=base/'state';state.mkdir(exist_ok=True);jobs=state/'jobs';jobs.mkdir(exist_ok=True)
legacy=Path(os.environ['LOCALAPPDATA'])/'ZakypitPrintAgent'
def old_hashes():return {str(p.relative_to(legacy)):hashlib.sha256(p.read_bytes()).hexdigest() for p in legacy.rglob('*.json')} if legacy.exists() else {}
before=old_hashes();config=b'{"printer":"Retained fixture printer"}';(state/'config.json').write_bytes(config)
body=json.dumps({'job_id':'supply-native-test-completed-0001','printer':'Retained fixture printer','stickers':[{'file':'fixture-not-printed','width_mm':58,'height_mm':40}]},separators=(',',':'))
digest=hashlib.sha256(body.encode()).hexdigest().upper();record=json.dumps({'status':'completed','digest':digest,'count':1});(jobs/'supply-native-test-completed-0001.json').write_text(record,encoding='utf-8-sig')
stop=base/'stop.signal'
if stop.exists():stop.unlink()
exe=Path('print-agent/windows/build/supply-print-agent.exe').resolve();proc=subprocess.Popen([str(exe),'--port','17991','--state-dir',str(state.resolve()),'--no-tray','--stop-file',str(stop.resolve())],creationflags=subprocess.CREATE_NO_WINDOW)
def request(path='/health?quick=1',body=None,origin=None,header=True):
 headers={}
 if origin:headers['Origin']=origin
 if body is not None:
  headers['Content-Type']='application/json'
  if header:headers['X-WMS-Print-Agent']='Supplyo'
 r=urllib.request.Request('http://127.0.0.1:17991'+path,data=body.encode() if body is not None else None,headers=headers)
 try:
  with urllib.request.urlopen(r,timeout=3) as response:return response.status,json.loads(response.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
try:
 for _ in range(60):
  try:
   if request()[0]==200:break
  except Exception:time.sleep(.2)
 else:raise RuntimeError('Agent did not start')
 assert request()[1]['printer']=='Retained fixture printer'
 health=request()[1];assert health['mediaSizes'] is True and health['deviceId']==(state/'device-id.txt').read_text().strip()
 wrong=json.loads(body);wrong['device_id']='00000000-0000-4000-8000-000000000000';assert request('/print-batch',json.dumps(wrong),'https://77-87-212-236.sslip.io')[0]==500
 invalid=json.loads(body);invalid['stickers'][0]['width_mm']=1;assert request('/print-batch',json.dumps(invalid),'https://77-87-212-236.sslip.io')[0]==500
 assert request('/printers')[1]['ok']
 assert request('/health?quick=1',origin='https://untrusted.example')[0]==403
 assert request('/print-batch',body,'https://77-87-212-236.sslip.io',False)[0]==403
 status,data=request('/print-batch',body,'https://77-87-212-236.sslip.io');assert status==200 and data['duplicate'] is True
 assert (jobs/'supply-native-test-completed-0001.json').read_text(encoding='utf-8-sig')==record
 changed=body.replace('fixture-not-printed','changed-content');assert request('/print-batch',changed,'https://77-87-212-236.sslip.io')[0]==500
 pending=body.replace('completed-0001','pending-00001');pending_id=json.loads(pending)['job_id'];(jobs/(pending_id+'.json')).write_text(json.dumps({'status':'started','digest':hashlib.sha256(pending.encode()).hexdigest().upper()}),encoding='utf-8')
 assert request('/print-batch',pending,'https://77-87-212-236.sslip.io')[0]==409
 connection=http.client.HTTPConnection('127.0.0.1',17991,timeout=5)
 connection.putrequest('POST','/print-batch');connection.putheader('Content-Type','application/json');connection.putheader('X-WMS-Print-Agent','Supplyo');connection.putheader('Origin','https://77-87-212-236.sslip.io');connection.putheader('Content-Length',str(len(body.encode())));connection.endheaders();connection.send(body.encode()[:20]);time.sleep(.3)
 stop.write_text('stop');time.sleep(.5);assert proc.poll() is None,'stop must wait for accepted request';connection.send(body.encode()[20:]);response=connection.getresponse();assert response.status==200 and json.loads(response.read())['duplicate'];connection.close()
 proc.wait(timeout=8);assert proc.returncode==0
 assert (state/'config.json').read_bytes()==config
 assert old_hashes()==before,'existing working agent config/job files changed'
 assert 'Spool accepted' not in (state/'agent.log').read_text(encoding='utf-8-sig')
 print(json.dumps({'native_agent':True,'health_and_printers':True,'legacy_dedup_compatible':True,'uncertain_and_modified_jobs_blocked':True,'untrusted_origin_blocked':True,'graceful_stop':True,'existing_settings_untouched':True,'real_prints':0}))
finally:
 if proc.poll() is None:
  stop.write_text('stop');proc.wait(timeout=8)
