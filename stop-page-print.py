from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig');s=s.replace(",[printItem,setPrintItem]=useState<Item|null>(null)",'')
a=s.index(' function startPrint(');b=s.index(' function saveKiz()',a)
s=s[:a]+" function startPrint(_item:Item){setActionItem(null);toast.error('Печать не подключена: нужен печатный агент и файл стикера WB.')}\n"+s[b:]
a=s.index(' {printItem&&');b=s.index('\n <Dialog open={!!actionItem}',a);s=s[:a]+s[b:]
p.write_text(s,encoding='utf-8')
