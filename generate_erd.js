const fs = require('fs');

const schemaStr = fs.readFileSync('schema_parsed.json', 'utf8');
const schema = JSON.parse(schemaStr);

let nodes = [];
let edges = [];

let tableIdMap = {};
let idCounter = 1;

for (let tName in schema) {
    tableIdMap[tName] = idCounter++;
}

for (let tName in schema) {
    const tData = schema[tName];
    nodes.push({
        id: tableIdMap[tName],
        label: tName,
        title: `<b>${tName}</b><br>File: ${tData.file}`,
        group: tData.file.split('_')[0] // group by prefix like '00', '01'
    });
    
    // foreign keys
    tData.fks.forEach(fk => {
        if (tableIdMap[fk]) {
            edges.push({
                from: tableIdMap[tName],
                to: tableIdMap[fk],
                arrows: 'to',
                title: `${tName} -> ${fk}`
            });
        }
    });
}

const htmlTemplate = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Co-CEO Platform - DER (Diagrama Entidade-Relacionamento)</title>
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style type="text/css">
        body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; display: flex; height: 100vh; background: #0f172a; color: #f8fafc; }
        #network { width: 70%; height: 100%; border-right: 1px solid #334155; }
        #sidebar { width: 30%; height: 100%; padding: 20px; box-sizing: border-box; overflow-y: auto; background: #1e293b; }
        h1, h2, h3 { color: #e2e8f0; }
        .col-list { list-style-type: none; padding: 0; }
        .col-item { padding: 8px; border-bottom: 1px solid #334155; font-family: monospace; font-size: 13px; color: #cbd5e1; }
        .fk-item { color: #38bdf8; cursor: pointer; text-decoration: underline; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; background: #475569; font-size: 11px; margin-bottom: 10px; }
    </style>
</head>
<body>

<div id="network"></div>
<div id="sidebar">
    <h2>DER Interativo</h2>
    <p>Clique em uma entidade (tabela) no gr&aacute;fico para ver seus detalhes, campos e relacionamentos aqui.</p>
    <p>Use o scroll do mouse para dar zoom e arraste para mover.</p>
    <div id="details" style="display:none;">
        <h3 id="det-title"></h3>
        <span class="badge" id="det-file"></span>
        <p id="det-comment" style="font-size: 14px; color: #94a3b8; font-style: italic;"></p>
        
        <h4>Relacionamentos (Sa&iacute;da)</h4>
        <ul id="det-fks" class="col-list"></ul>
        
        <h4>Relacionamentos (Entrada)</h4>
        <ul id="det-incoming" class="col-list"></ul>
        
        <h4>Campos</h4>
        <ul id="det-cols" class="col-list"></ul>
    </div>
</div>

<script type="text/javascript">
    const rawSchema = ${JSON.stringify(schema)};
    const nodesData = ${JSON.stringify(nodes)};
    const edgesData = ${JSON.stringify(edges)};
    const tableIdMap = ${JSON.stringify(tableIdMap)};
    
    // reverse lookup
    const idTableMap = {};
    for (let k in tableIdMap) idTableMap[tableIdMap[k]] = k;

    // Provide some nice colors based on groups
    nodesData.forEach(n => {
        n.shape = 'box';
        n.font = { color: '#ffffff', face: 'Inter', size: 14 };
        n.color = {
            background: '#3b82f6', border: '#2563eb',
            highlight: { background: '#ef4444', border: '#b91c1c' }
        };
        n.margin = 10;
        
        // Custom colors based on group prefix
        if (n.group === '00') { n.color.background = '#8b5cf6'; n.color.border = '#7c3aed'; } // SaaS
        else if (n.group === '01') { n.color.background = '#10b981'; n.color.border = '#059669'; } // Invest
        else if (n.group === '03') { n.color.background = '#f59e0b'; n.color.border = '#d97706'; } // IAM
        else if (n.group === '11') { n.color.background = '#0ea5e9'; n.color.border = '#0284c7'; } // Patrimony
        else if (n.group === '12') { n.color.background = '#6366f1'; n.color.border = '#4f46e5'; } // Financial
        else if (n.group === '42') { n.color.background = '#ec4899'; n.color.border = '#db2777'; } // Market Arch
        else if (n.group === '43') { n.color.background = '#14b8a6'; n.color.border = '#0d9488'; } // Op Policy
    });

    const container = document.getElementById('network');
    const data = { nodes: new vis.DataSet(nodesData), edges: new vis.DataSet(edgesData) };
    const options = {
        physics: {
            stabilization: false,
            barnesHut: {
                gravitationalConstant: -30000,
                springConstant: 0.04,
                springLength: 200
            }
        },
        edges: {
            color: '#64748b',
            width: 1,
            smooth: { type: 'continuous' }
        },
        interaction: { hover: true }
    };
    
    const network = new vis.Network(container, data, options);
    
    // Setup Sidebar Interaction
    network.on('click', function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const tName = idTableMap[nodeId];
            const tData = rawSchema[tName];
            
            document.getElementById('details').style.display = 'block';
            document.getElementById('det-title').innerText = tName;
            document.getElementById('det-file').innerText = 'Arquivo: ' + tData.file;
            document.getElementById('det-comment').innerText = tData.comment ? tData.comment : '';
            
            // Render columns
            const colsUl = document.getElementById('det-cols');
            colsUl.innerHTML = '';
            tData.cols.forEach(c => {
                let li = document.createElement('li');
                li.className = 'col-item';
                li.innerText = c;
                colsUl.appendChild(li);
            });
            
            // Render FKs (outgoing)
            const fksUl = document.getElementById('det-fks');
            fksUl.innerHTML = '';
            if (tData.fks.length === 0) fksUl.innerHTML = '<li class="col-item">Nenhum</li>';
            tData.fks.forEach(fk => {
                let li = document.createElement('li');
                li.className = 'col-item fk-item';
                li.innerText = fk;
                li.onclick = () => focusOnNode(fk);
                fksUl.appendChild(li);
            });
            
            // Render incoming relations
            const incomingUl = document.getElementById('det-incoming');
            incomingUl.innerHTML = '';
            let incoming = [];
            for(let otherTable in rawSchema) {
                if(rawSchema[otherTable].fks.includes(tName)) incoming.push(otherTable);
            }
            if (incoming.length === 0) incomingUl.innerHTML = '<li class="col-item">Nenhum</li>';
            incoming.forEach(inc => {
                let li = document.createElement('li');
                li.className = 'col-item fk-item';
                li.innerText = inc;
                li.onclick = () => focusOnNode(inc);
                incomingUl.appendChild(li);
            });
        } else {
            document.getElementById('details').style.display = 'none';
        }
    });
    
    function focusOnNode(tableName) {
        const nodeId = tableIdMap[tableName];
        if (nodeId) {
            network.selectNodes([nodeId]);
            network.focus(nodeId, { scale: 1.2, animation: { duration: 500 }});
            // trigger click event manually
            network.emit('click', { nodes: [nodeId] });
        }
    }
</script>
</body>
</html>
`;

fs.writeFileSync('DER_Arquitetura.html', htmlTemplate);
console.log('HTML GERADO com sucesso: DER_Arquitetura.html');
