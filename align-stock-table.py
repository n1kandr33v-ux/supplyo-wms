from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');s=s.replace("['36%','170px','auto','180px','130px']","['auto','180px','170px','170px','140px']");p.write_text(s,encoding='utf-8')
p=Path('src/index.css');s=p.read_text(encoding='utf-8');s+='''
.orders-table-stocks :is([data-slot=table-head],[data-slot=table-cell]){text-align:left;padding-left:12px;padding-right:12px;vertical-align:middle}.orders-table-stocks :is([data-slot=table-head],[data-slot=table-cell]):first-child{padding-left:0}.orders-table-stocks .stock-text-value{width:140px;max-width:100%;padding-right:0}.orders-table-stocks [data-slot=table-cell]{height:76px}.orders-table-stocks .stock-quantity-value{grid-template-columns:76px max-content;justify-content:start}.orders-table-stocks .product-barcodes{gap:4px}
''';p.write_text(s,encoding='utf-8')
