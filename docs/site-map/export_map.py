import json
import math
import re
import html
import zipfile
import hashlib
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = json.loads((BASE / 'layout.json').read_text(encoding='utf-8'))
COLORS = {
    'action': ('#E2F1FF', '#5197CE'),
    'decision': ('#FFF0C9', '#C99726'),
    'success': ('#DFF4E4', '#65A773'),
    'error': ('#FFE3DE', '#D37D6A'),
    'pending': ('#FFF0C9', '#C99726'),
    'portal': ('#EDE6FF', '#9C83CF'),
    'role': ('#EDE6FF', '#9C83CF'),
    'note': ('#F5F6F8', '#A5AFBE'),
    'target': ('#FFE9D5', '#C99768'),
}
DX, DY = 0, 230

def connect_diamond_ports():
    # ELK lays out rectangular bounds; attach routes to the visible diamond.
    for p in DATA['panels']:
        by_id = {n['id']: n for n in p['nodes']}
        for e in p['edges']:
            for section in e['layout'].get('sections', []):
                for field, identifier in [('startPoint', e['from']), ('endPoint', e['to'])]:
                    n = by_id[identifier]
                    if n['kind'] != 'decision': continue
                    point = section[field]
                    cx, cy = n['x'] + n['width']/2, n['y'] + n['height']/2
                    if abs(point['y'] - n['y']) < .01 or abs(point['y'] - n['y'] - n['height']) < .01:
                        sign = -1 if point['y'] < cy else 1
                        point['y'] = cy + sign * n['height']/2 * (1 - abs(point['x']-cx)/(n['width']/2))
                    else:
                        sign = -1 if point['x'] < cx else 1
                        point['x'] = cx + sign * n['width']/2 * (1 - abs(point['y']-cy)/(n['height']/2))

def cell(root, identifier, text='', style='', parent='1', **attrs):
    return ET.SubElement(root, 'mxCell', {'id': identifier, 'value': text,
        'style': style, 'parent': parent, **attrs})

def vertex(root, identifier, text, x, y, w, h, style, link=None):
    c = cell(root, identifier, text, style, vertex='1')
    if link:
        attach_link(root, c, 'data:page/id,p' + link)
    ET.SubElement(c, 'mxGeometry', {'x': str(x), 'y': str(y), 'width': str(w),
                                 'height': str(h), 'as': 'geometry'})
    return c

def attach_link(root, c, link):
    root.remove(c)
    wrapper = ET.SubElement(root, 'object', {'id': c.attrib.pop('id'),
        'label': c.attrib.pop('value'), 'link': link})
    wrapper.append(c)

def model(diagram):
    m = ET.SubElement(diagram, 'mxGraphModel', {'dx': '1600', 'dy': '1000',
        'grid': '1', 'gridSize': '10', 'guides': '1', 'tooltips': '1',
        'connect': '1', 'arrows': '1', 'fold': '1', 'page': '0',
        'pageScale': '1', 'math': '0', 'shadow': '0'})
    r = ET.SubElement(m, 'root')
    ET.SubElement(r, 'mxCell', {'id': '0'})
    ET.SubElement(r, 'mxCell', {'id': '1', 'parent': '0'})
    return r

def reference(panel, node):
    direct = {'00': {'start': '01', 'seller': '04', 'ff': '06', 'staff': '07',
        'core': '09', 'finance': '15', 'settings': '03', 'other': '13'}}
    target = node.get('target') or direct.get(panel['id'], {}).get(node['id'])
    if not target and node['kind'] == 'portal':
        found = re.search(r'(?<!\d)(0[1-9]|1\d|2[01])(?=\s|\b)', node['text'])
        target = found.group(1) if found else None
    return target if target != panel['id'] else None

def svg_text(text, x, y, size=20, color='#233044', weight='400', anchor='start'):
    return (f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" '
            f'font-size="{size}" fill="{color}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{html.escape(text)}</text>')

def wrap(text, limit=105):
    words = text.split()
    lines, line = [], ''
    for word in words:
        if len(line + ' ' + word) > limit and line:
            lines.append(line)
            line = word
        else:
            line = (line + ' ' + word).strip()
    return lines + ([line] if line else [])

def footer_metrics(p):
    width = max(p['width'], 1500)
    lines = wrap(p['notes'], max(100, int((width-140) / 11)))
    return lines, max(150, len(lines)*28+90)

def page_height(p):
    return p['height'] + DY + footer_metrics(p)[1]

def make_svg(p):
    width = max(p['width'], 1500)
    height = page_height(p)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
         '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B"/></marker></defs>',
         f'<rect width="{width}" height="{height}" fill="#FFFFFF"/>',
         svg_text('SUPPLY / КАРТА САЙТА И ANDROID / ' + p['id'], 70, 43, 17, '#6A7585'),
         svg_text(p['id'] + ' · ' + p['title'], 70, 89, 32, weight='700'),
         svg_text(p['scope'], 70, 127, 20, '#64748B')]
    for i, line in enumerate(wrap('Реализация: ' + p['status'], max(105, int(width / 11)))):
        s.append(svg_text(line, 70, 166 + i * 25, 17, '#64748B'))
    for e in p['edges']:
        for section in e['layout'].get('sections', []):
            points = [section['startPoint']] + section.get('bendPoints', []) + [section['endPoint']]
            d = ' '.join(('M' if i == 0 else 'L') + f" {pt['x'] + DX} {pt['y'] + DY}" for i, pt in enumerate(points))
            s.append(f'<path d="{d}" fill="none" stroke="#64748B" stroke-width="2.5" stroke-linejoin="round" marker-end="url(#arrow)"/>')
    for e in p['edges']:
        for lab in e['layout'].get('labels', []):
            x, y, w, h = lab['x'] + DX, lab['y'] + DY, lab['width'], lab['height']
            s.append(f'<rect x="{x-4}" y="{y-2}" width="{w+8}" height="{h+4}" rx="4" fill="white"/>')
            s.append(svg_text(e['label'], x + w / 2, y + 20, 18, anchor='middle'))
    for n in p['nodes']:
        x, y, w, h = n['x'] + DX, n['y'] + DY, n['width'], n['height']
        fill, stroke = COLORS.get(n['kind'], COLORS['action'])
        link = reference(p, n)
        if link:
            s.append(f'<a href="#{link}"><title>Открыть раздел {link}</title>')
        if n['kind'] == 'decision':
            s.append(f'<polygon points="{x+w/2},{y} {x+w},{y+h/2} {x+w/2},{y+h} {x},{y+h/2}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        else:
            s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        ty = y + h / 2 - (len(n['lines']) - 1) * 14 + 7
        for i, line in enumerate(n['lines']):
            s.append(svg_text(line, x + w / 2, ty + i * 28, 20, weight='600' if i == 0 else '400', anchor='middle'))
        if link:
            s.append('</a>')
    for i, line in enumerate(footer_metrics(p)[0]):
        s.append(svg_text(line, 70, p['height'] + DY + 40 + i * 28, 18, '#475569'))
    s.append(svg_text('↖ Оглавление — слева. Файл .drawio содержит редактируемые блоки и стрелки.', 70, height - 28, 16, '#6A7585'))
    return '\n'.join(s) + '</svg>'

def make_drawio():
    file = ET.Element('mxfile', {'host': 'app.diagrams.net', 'type': 'device',
        'version': '24.7.17', 'modified': DATA['date']+'T00:00:00.000Z',
        'agent': 'supply site and Android map'})
    index = ET.SubElement(file, 'diagram', {'id': 'index', 'name': 'ОГЛАВЛЕНИЕ — начните здесь'})
    r = model(index)
    plain = 'text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;fontFamily=Arial;'
    vertex(r, 'index-title', 'supply — сайт и Android · '+'.'.join(reversed(DATA['date'].split('-'))), 60, 20, 1500, 70, plain + 'fontSize=38;fontStyle=1;')
    vertex(r, 'index-guide', str(len(DATA['panels']))+' связанных раздела. Двойной щелчок — изменить текст. Перетащите блок или конец стрелки — изменить схему.\nНомера разделов в блоках ведут к продолжению сценария. Оранжевым отмечена целевая реализация.', 60, 100, 1500, 100, plain + 'fontSize=20;')
    index_rows = math.ceil(len(DATA['panels']) / 3)
    for i, p in enumerate(DATA['panels']):
        col, row = i // index_rows, i % index_rows
        vertex(r, 'index-' + p['id'], p['id'] + ' · ' + p['title'], 60 + col * 570, 240 + row * 130,
            530, 105, 'rounded=1;whiteSpace=wrap;html=0;fillColor=#EDE6FF;strokeColor=#9C83CF;fontColor=#233044;fontSize=22;fontFamily=Arial;spacing=24;align=left;', p['id'])
    vertex(r, 'index-paths', 'Рекомендуемые маршруты:\nКлиент: 01 → 04 → 05 → 08.\nВладелец ФФ: 01 → 02 → 06 → 05 → 07 → 09 → 10 → 11 → 12.\nСотрудник: 01 → 07 → 09 → 10 → 11 → 12.\nУчёт: 15 → 16 / 17. Инфраструктура: 19. Android: 20. Готово / планы: 21.', 60, 240 + index_rows*130 + 40, 1630, 250, plain + 'fontSize=22;')
    for p in DATA['panels']:
        diagram = ET.SubElement(file, 'diagram', {'id': 'p' + p['id'], 'name': p['id'] + ' · ' + p['title']})
        r = model(diagram)
        wide = max(p['width'] - 140, 1360)
        vertex(r, 'title-' + p['id'], p['id'] + ' · ' + p['title'], 70, 20, wide, 65, plain + 'fontSize=34;fontStyle=1;')
        vertex(r, 'scope-' + p['id'], p['scope'], 70, 90, wide, 45, plain + 'fontSize=21;fontColor=#64748B;')
        vertex(r, 'status-' + p['id'], 'Реализация: ' + p['status'], 70, 140, wide, 80, plain + 'fontSize=18;fontColor=#64748B;')
        by_id = {n['id']: n for n in p['nodes']}
        for n in p['nodes']:
            fill, stroke = COLORS.get(n['kind'], COLORS['action'])
            shape = 'rhombus;' if n['kind'] == 'decision' else 'rounded=1;arcSize=10;'
            style = (shape + 'whiteSpace=wrap;html=0;fillColor=' + fill + ';strokeColor=' + stroke +
                     ';strokeWidth=2;fontColor=#233044;fontSize=20;fontFamily=Arial;spacing=24;align=center;verticalAlign=middle;')
            vertex(r, p['id'] + '-' + n['id'], '\n'.join(n['lines']), n['x'] + DX, n['y'] + DY,
                   n['width'], n['height'], style, reference(p, n))
        for i, e in enumerate(p['edges']):
            sections = e['layout'].get('sections', [])
            if not sections:
                raise ValueError('Missing route: ' + p['id'] + str(e))
            section = sections[0]
            source, target = by_id[e['from']], by_id[e['to']]
            start, end = section['startPoint'], section['endPoint']
            frac = lambda point, node, axis: (point[axis] - node[axis]) / node['width' if axis == 'x' else 'height']
            style = ('edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow=block;endFill=1;strokeColor=#64748B;strokeWidth=2;'
                     'fontColor=#233044;fontSize=18;fontFamily=Arial;labelBackgroundColor=#FFFFFF;'
                     f"exitX={frac(start,source,'x')};exitY={frac(start,source,'y')};entryX={frac(end,target,'x')};entryY={frac(end,target,'y')};exitPerimeter=0;entryPerimeter=0;")
            c = cell(r, p['id'] + '-edge-' + str(i), e['label'], style, edge='1',
                     source=p['id'] + '-' + e['from'], target=p['id'] + '-' + e['to'])
            g = ET.SubElement(c, 'mxGeometry', {'relative': '1', 'as': 'geometry'})
            if section.get('bendPoints'):
                points = ET.SubElement(g, 'Array', {'as': 'points'})
                for point in section['bendPoints']:
                    ET.SubElement(points, 'mxPoint', {'x': str(point['x'] + DX), 'y': str(point['y'] + DY)})
        vertex(r, 'notes-' + p['id'], p['notes'], 70, p['height'] + DY + 15, wide, max(60,len(footer_metrics(p)[0])*28+15), plain + 'fontSize=20;fontColor=#475569;')
        back = vertex(r, 'back-' + p['id'], '← К оглавлению', 70, page_height(p)-55, 260, 50,
                      'rounded=1;html=0;fillColor=#EDE6FF;strokeColor=#9C83CF;fontSize=20;fontFamily=Arial;')
        attach_link(r, back, 'data:page/id,index')
    ET.indent(file, space='  ')
    ET.ElementTree(file).write(BASE / 'Supplyo-full-site.drawio', encoding='utf-8', xml_declaration=True)

def make_preview():
    views = []
    for p in DATA['panels']:
        svg = make_svg(p)
        (BASE / (p['id'] + '-scheme.svg')).write_text(svg, encoding='utf-8')
        views.append({'id': p['id'], 'title': p['title'], 'scope': p['scope'], 'svg': svg,
                      'width': max(p['width'], 1500), 'height': page_height(p)})
    template = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>supply · Карта сайта и Android</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e9edf2;color:#233044;font:15px Arial,sans-serif}aside{position:fixed;inset:0 auto 0 0;width:320px;background:#fff;overflow:auto;border-right:1px solid #d9dfe9;padding:24px 16px}h1{font-size:23px;margin:0 8px 10px}aside p{color:#64748b;line-height:1.55;margin:8px}nav{margin-top:20px}nav a{display:block;color:#39465a;padding:10px 12px;text-decoration:none;border-radius:8px;line-height:1.35}nav a.active{color:#5733a2;background:#ede6ff}nav a:hover{background:#f1f3f7}main{margin-left:320px}header{position:sticky;top:0;background:#ffffffee;backdrop-filter:blur(8px);z-index:2;border-bottom:1px solid #d9dfe9;padding:14px 22px;display:flex;gap:8px;align-items:center}button,.download{background:white;border:1px solid #ccd4e0;border-radius:7px;padding:9px 14px;color:#233044;cursor:pointer;text-decoration:none;font:inherit}button:hover,.download:hover{background:#f0edf9}.download{margin-left:auto;background:#ede6ff;color:#5733a2}#canvas{padding:24px;overflow:auto;min-height:calc(100vh - 70px)}#paper{background:white;box-shadow:0 4px 25px #25385815;transform-origin:top left;width:max-content}#paper svg{display:block}#chapter{font-size:14px;color:#64748b;margin-left:8px}a{cursor:pointer}@media(max-width:900px){aside{width:235px}main{margin-left:235px}header{flex-wrap:wrap}.download{margin-left:0}#chapter{display:none}}</style>
<aside><h1>supply</h1><p>Сайт и Android · __DATE__<br>__COUNT__ раздела, три роли, актуальные сценарии.</p><p>Клиент: 01 → 04 → 05 → 08<br>Владелец ФФ: 01 → 02 → 06 → 05 → 07 → 09–12<br>Сотрудник: 01 → 07 → 09–12<br>Android: 20 · Готово / планы: 21</p><nav id="nav"></nav><p>Схема отражает текущую реализацию. Оставшиеся планы отмечены оранжевым и собраны отдельно в разделе 21.</p><p>Для редактирования откройте файл .drawio в diagrams.net. Все блоки и стрелки — отдельные объекты.</p></aside>
<main><header><button onclick="step(-1)">← Назад</button><button onclick="step(1)">Далее →</button><button onclick="zoom(.8)">−</button><button onclick="zoom(1.25)">+</button><button onclick="fit()">По ширине</button><span id="chapter"></span><a class="download" href="Supplyo-full-site.drawio" download>Скачать редактируемую схему</a></header><div id="canvas"><div id="paper"></div></div></main>
<script>const views=__VIEWS__;let current=0,scale=1;const nav=document.querySelector('#nav'),paper=document.querySelector('#paper'),canvas=document.querySelector('#canvas');nav.innerHTML=views.map(v=>`<a href="#${v.id}" data-id="${v.id}">${v.id} · ${v.title}</a>`).join('');function resize(){paper.style.zoom=scale}function fit(){scale=Math.min(1,(canvas.clientWidth-48)/views[current].width);resize()}function show(){const found=views.findIndex(v=>v.id===location.hash.slice(1));current=found<0?0:found;paper.innerHTML=views[current].svg;document.querySelector('#chapter').textContent=`${current+1} / ${views.length}`;nav.querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.dataset.id===views[current].id));canvas.scrollTop=0;window.scrollTo(0,0);fit()}function step(d){location.hash=views[Math.max(0,Math.min(views.length-1,current+d))].id}function zoom(f){scale=Math.max(.15,Math.min(2,scale*f));resize()}window.addEventListener('hashchange',show);show();</script></html>'''
    (BASE / 'Supplyo-map-preview.html').write_text(template.replace('__VIEWS__', json.dumps(views, ensure_ascii=False)).replace('__DATE__','.'.join(reversed(DATA['date'].split('-')))).replace('__COUNT__',str(len(DATA['panels']))), encoding='utf-8')

def validate():
    errors = []
    nodes = edges = 0
    for p in DATA['panels']:
        nodes += len(p['nodes']); edges += len(p['edges'])
        ids = {n['id'] for n in p['nodes']}
        if len(ids) != len(p['nodes']): errors.append(p['id'] + ': duplicate node')
        for e in p['edges']:
            if e['from'] not in ids or e['to'] not in ids: errors.append(p['id'] + ': missing endpoint')
            for sec in e['layout'].get('sections', []):
                points = [sec['startPoint']] + sec.get('bendPoints', []) + [sec['endPoint']]
                for a, b in zip(points, points[1:]):
                    for n in p['nodes']:
                        if n['id'] in (e['from'], e['to']): continue
                        left, right = n['x']+2, n['x']+n['width']-2
                        top, bottom = n['y']+2, n['y']+n['height']-2
                        if a['x'] == b['x']:
                            hit = left < a['x'] < right and max(min(a['y'],b['y']),top) < min(max(a['y'],b['y']),bottom)
                        else:
                            hit = top < a['y'] < bottom and max(min(a['x'],b['x']),left) < min(max(a['x'],b['x']),right)
                        if hit: errors.append(f"{p['id']}: edge {e['from']}->{e['to']} crosses {n['id']}")
        for i, a in enumerate(p['nodes']):
            for b in p['nodes'][i+1:]:
                if max(a['x'],b['x']) < min(a['x']+a['width'],b['x']+b['width']) and max(a['y'],b['y']) < min(a['y']+a['height'],b['y']+b['height']):
                    errors.append(p['id'] + ': overlapping nodes')
    doc = ET.parse(BASE / 'Supplyo-full-site.drawio')
    assert len(doc.findall('diagram')) == len(DATA['panels'])+1
    page_ids={p['id'] for p in DATA['panels']}
    for p in DATA['panels']:
        for n in p['nodes']:
            target=reference(p,n)
            if target and target not in page_ids: errors.append(p['id']+': invalid page link '+target)
    result = {'chapters': len(DATA['panels']), 'nodes': nodes, 'edges': edges, 'pages': len(DATA['panels'])+1, 'errors': errors}
    (BASE / 'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    if errors: raise SystemExit(1)

connect_diamond_ports()
make_drawio()
make_preview()
validate()


def make_bundle():
    paths=[BASE/'Supplyo-full-site.drawio',BASE/'Supplyo-map-preview.html',BASE/'supplyo-site-map.json',BASE/'validation.json',BASE/'КАК РЕДАКТИРОВАТЬ.txt',BASE/'ОБНОВЛЕНИЯ-2026-11-12.md']
    paths += sorted(BASE.glob('*-scheme.svg'))
    paths=[p for p in paths if p.is_file()]
    manifest={'date':DATA['date'],'chapters':len(DATA['panels']),'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    (BASE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    paths.append(BASE/'manifest.json')
    with zipfile.ZipFile(BASE/'Supplyo-site-map.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
        for path in paths:z.write(path,path.name)
make_bundle()
