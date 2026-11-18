import json, math
from pathlib import Path
from PIL import ImageFont

root = Path(__file__).parent
source = json.loads((root / 'supplyo-site-map.json').read_text(encoding='utf-8-sig'))
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)

def wrap(text, width):
    out = []
    for para in text.split('\n'):
        words = para.split(' ')
        line = ''
        for word in words:
            nxt = (line + ' ' + word).strip()
            if font.getlength(nxt) <= width or not line:
                line = nxt
            else:
                out.append(line)
                line = word
        out.append(line)
    return out

for panel in source['panels']:
    for node in panel['nodes']:
        decision = node['kind'] == 'decision'
        node['lines'] = wrap(node['text'], 238 if decision else 372)
        node['width'] = 460
        node['height'] = max(220 if decision else 130, len(node['lines']) * (56 if decision else 28) + 72)
    for edge in panel['edges']:
        edge['labelWidth'] = math.ceil(font.getlength(edge['label']) * 0.9) + 18
(root / 'measured.json').write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding='utf-8')
