const fs = require('fs');
const path = require('path');
const ELK = require('./_tools/node_modules/elkjs/lib/elk.bundled.js');
const root = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(root, 'measured.json'), 'utf8'));
const elk = new ELK();
(async () => {
  for (const p of data.panels) {
    const graph = {
      id: 'panel' + p.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '100',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.spacing.edgeNode': '38',
        'elk.spacing.edgeEdge': '28',
        'elk.layered.spacing.edgeNodeBetweenLayers': '38',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '26',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.padding': '[top=50,left=70,bottom=60,right=70]',
        'elk.separateConnectedComponents': 'true',
        'elk.spacing.componentComponent': '130'
      },
      children: p.nodes.map((n, i) => ({id: n.id, width: n.width, height: n.height,
        layoutOptions: i === 0 ? {'elk.layered.layering.layerConstraint': 'FIRST'} : {}})),
      edges: p.edges.map((e, i) => ({
        id: 'e'+i, sources:[e.from], targets:[e.to],
        labels: e.label ? [{text:e.label, width:e.labelWidth, height:26}] : []
      }))
    };
    const layout = await elk.layout(graph);
    for (const n of p.nodes) Object.assign(n, layout.children.find(c => c.id === n.id));
    for (let i = 0; i < p.edges.length; i++) p.edges[i].layout = layout.edges[i];
    p.width = Math.ceil(layout.width);
    p.height = Math.ceil(layout.height);
  }
  fs.writeFileSync(path.join(root, 'layout.json'), JSON.stringify(data, null, 2));
  console.log(data.panels.map(p => p.id + ': ' + p.width + 'x' + p.height).join('\n'));
})();
