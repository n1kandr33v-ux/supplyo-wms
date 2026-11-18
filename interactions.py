from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8')
a=s.index('<span className="brand-symbol">');b=s.index('</a>',a)
s=s[:a]+'<img className="brand-image" src="/brand-logo.png" alt="Supplyo"/>'+s[b:]
pos=s.index('export default function App()')
s=s[:pos]+'''function AnimatedNumber({value}:{value:number}){return <span key={value} className="number-reveal">{value.toLocaleString('ru')}</span>}
'''+s[pos:]
s=s.replace("{m.value.toLocaleString('ru')}",'<AnimatedNumber key={client} value={m.value}/>').replace('{orders}</strong>','<AnimatedNumber key={client} value={orders}/></strong>').replace("{quantity.toLocaleString('ru')}",'<AnimatedNumber key={client} value={quantity}/>')
p.write_text(s,encoding='utf-8')
