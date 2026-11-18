from pathlib import Path
p=Path('vite.config.ts');s=p.read_text();s=s.replace('defineConfig({plugins:',"defineConfig({base:process.env.GITHUB_ACTIONS ? '/supplyo-wms/' : '/',plugins:");p.write_text(s)
p=Path('src/App.tsx');s=p.read_text(encoding='utf-8-sig').replace('src="/brand-logo.png"','src={`${import.meta.env.BASE_URL}brand-logo.png`}');p.write_text(s,encoding='utf-8')
p=Path('.gitignore');s=p.read_text();p.write_text(s+'\n.agents/\n*.py\n')
Path('.github/workflows').mkdir(parents=True,exist_ok=True)
Path('.github/workflows/pages.yml').write_text('''name: Deploy GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
''')
