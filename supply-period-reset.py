from pathlib import Path
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8');old="{(supplyWarehouse!=='Все склады'||supplyFrom||supplyTo)&&<Button variant=\"ghost\" onClick={()=>{setSupplyWarehouse('Все склады');setSupplyFrom('');setSupplyTo('')}}>Сбросить</Button>}";assert old in s;s=s.replace(old,'');p.write_text(s,encoding='utf-8')
