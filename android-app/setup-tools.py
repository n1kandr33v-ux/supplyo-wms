from pathlib import Path
import requests,zipfile,xml.etree.ElementTree as ET,concurrent.futures
root=Path(__file__).resolve().parent.parent/'.android-tools';root.mkdir(exist_ok=True)
def download(url,dest):
 if dest.exists():return
 with requests.get(url,stream=True,timeout=120) as r:
  r.raise_for_status()
  with dest.open('wb') as f:
   for b in r.iter_content(1024*1024):f.write(b)
def job(kind):
 if kind=='jdk':
  if list(root.glob('jdk*/bin/javac.exe')):return
  asset=requests.get('https://api.adoptium.net/v3/assets/latest/17/hotspot',params={'architecture':'x64','image_type':'jdk','os':'windows'},timeout=40).json()[0]['binary']['package'];url=asset['link']
 else:
  tree=ET.fromstring(requests.get('https://dl.google.com/android/repository/repository2-3.xml',timeout=40).content)
  pkg=next(e for e in tree.iter() if e.tag.endswith('remotePackage') and e.get('path')=={'platform':'platforms;android-36','build':'build-tools;36.0.0'}[kind])
  archs=next(e for e in pkg if e.tag.endswith('archives'))
  archive=next(a for a in archs if not any(e.tag.endswith('host-os') for e in a) or any(e.tag.endswith('host-os') and e.text=='windows' for e in a))
  url='https://dl.google.com/android/repository/'+next(e.text for e in archive.iter() if e.tag.endswith('url'))
 dest=root/(kind+'.zip');download(url,dest)
 out=root/kind if kind!='jdk' else root
 if kind!='jdk' and out.exists():return
 with zipfile.ZipFile(dest) as z:z.extractall(out)
 print(kind+' ready',flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:list(ex.map(job,['jdk','platform','build']))
