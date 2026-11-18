from pathlib import Path
p=Path('src/components/editable-stock-value.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('return editing?<div','return <div className={numeric?"stock-quantity-value":"stock-text-value"}>{editing?<div')
s=s.replace("{value||'—'}{numeric?' шт.':''}</button>","{value||'—'}</button>}{numeric&&<span className=\"stock-unit\">шт.</span>}</div>")
p.write_text(s,encoding='utf-8')
