from pathlib import Path
p=Path('src/components/ui/table.tsx');s=p.read_text(encoding='utf-8');s=s.replace('border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted','border-b transition-colors has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted');p.write_text(s,encoding='utf-8')
