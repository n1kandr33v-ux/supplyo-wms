from pathlib import Path
import json,base64,io
from PIL import Image
f=max(Path(r'C:/Users/eleg1/.codex/sessions').rglob('*.jsonl'),key=lambda p:p.stat().st_mtime)
for line in f.open(encoding='utf-8'):
 try:o=json.loads(line)
 except:continue
 p=o.get('payload',{})
 if o.get('type')!='response_item' or p.get('role')!='user':continue
 for c in p.get('content',[]):
  u=c.get('image_url','');u=u.get('url','') if isinstance(u,dict) else u
  if not u.startswith('data:image'):continue
  try:
   data=base64.b64decode(u.split(',',1)[1]);im=Image.open(io.BytesIO(data))
   if im.size==(1254,1254):Path('public/brand-mark.png').write_bytes(data);print('Saved supplied mark')
  except:pass
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace('<img className="brand-image" src={`${import.meta.env.BASE_URL}brand-logo.png`} alt="Supplyo"/>','<img className="brand-image" src={`${import.meta.env.BASE_URL}brand-logo.png`} alt="Supplyo"/><img className="brand-mark" src={`${import.meta.env.BASE_URL}brand-mark.png`} alt="Supplyo"/>');p.write_text(s,encoding='utf-8')
