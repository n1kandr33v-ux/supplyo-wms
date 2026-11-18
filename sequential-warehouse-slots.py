from pathlib import Path
p=Path('src/components/personal-account.tsx');s=p.read_text(encoding='utf-8');s=s.replace('className="warehouse-add-placeholder" onClick','className="warehouse-add-placeholder" disabled={index>0} onClick');p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='\n.warehouse-add-placeholder:disabled{opacity:.4;cursor:default;pointer-events:none}\n';p.write_text(s,encoding='utf-8')
