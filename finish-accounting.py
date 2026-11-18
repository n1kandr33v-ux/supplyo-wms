from pathlib import Path
p=Path('src/components/accounting.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace('return rows}\nexport', 'return rows}\nexport')
s=s.replace('return rows}\nasync function documentStore', '''let firstWarehouse='unassigned';try{firstWarehouse=JSON.parse(localStorage.getItem('supplyo-warehouses')||'[]')[0]?.id||'unassigned'}catch{}rows=rows.map(row=>row.warehouseId?row:{...row,warehouseId:firstWarehouse});localStorage.setItem('supplyo-accounting',JSON.stringify(rows));return rows}
async function documentStore''')
s=s.replace('group.amount+=row.amount;group.title', 'group.amount+=row.amount;group.documents=[...(group.documents||[]),...(row.documents||[])];group.title')
p.write_text(s,encoding='utf-8')
