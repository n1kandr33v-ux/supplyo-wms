from pathlib import Path
import json,base64,io
from PIL import Image
files=sorted(Path(r'C:/Users/eleg1/.codex/sessions').rglob('*.jsonl'),key=lambda p:p.stat().st_mtime,reverse=True)
for f in files[:1]:
 for line in f.open(encoding='utf-8'):
  try:o=json.loads(line)
  except:continue
  if o.get('type')!='response_item':continue
  p=o.get('payload',{})
  if p.get('role')!='user':continue
  for c in p.get('content',[]):
   u=c.get('image_url','')
   if isinstance(u,dict):u=u.get('url','')
   if u.startswith('data:image'):
    try:
     data=base64.b64decode(u.split(',',1)[1]); im=Image.open(io.BytesIO(data))
     if im.size==(1280,427):
      Path('public').mkdir(exist_ok=True);Path('public/brand-logo.png').write_bytes(data);print('Found attached logo',im.size)
    except:pass
