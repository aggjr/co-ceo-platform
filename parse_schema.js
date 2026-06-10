const fs = require('fs');
const path = require('path');

const dir = 'src/database/migrations';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

let tables = {};

files.forEach(f => {
    const p = path.join(dir, f);
    const c = fs.readFileSync(p, 'utf8');
    
    // Simple regex to find CREATE TABLE. Handles IF NOT EXISTS, captures table name and body.
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s\(]+)\s*\(([\s\S]*?)\)(?:;|\s+ENGINE)/gi;
    let matches = [...c.matchAll(regex)];
    
    for (const m of matches) {
        let tName = m[1].replace(/[`"]/g, '');
        let body = m[2];
        
        // Extract columns. Simplified approach: split by lines, ignore keys.
        let cols = body.split('\n')
            .map(l => l.trim().replace(/,$/, ''))
            .filter(l => l && !l.startsWith('PRIMARY') && !l.startsWith('FOREIGN') && !l.startsWith('KEY') && !l.startsWith('CONSTRAINT') && !l.startsWith('UNIQUE'));
            
        // Extract comments from SQL if any.
        // E.g., `COMMENT '...'`
        let tableCommentMatch = body.match(/COMMENT\s*=\s*'([^']+)'/i);
        let tableComment = tableCommentMatch ? tableCommentMatch[1] : '';
        
        let fks = [...body.matchAll(/FOREIGN\s+KEY\s*\([^\)]+\)\s*REFERENCES\s+([^\s\(]+)/gi)]
            .map(fk => fk[1].replace(/[`"]/g, ''));
            
        tables[tName] = {
            cols: cols,
            fks: fks,
            file: f,
            comment: tableComment
        };
    }
});

fs.writeFileSync('schema_parsed.json', JSON.stringify(tables, null, 2));
console.log('done, tables: ' + Object.keys(tables).length);
