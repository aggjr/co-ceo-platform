import express from 'express';
import path from 'path';
import pool from './config/database';
import apiRoutes from './routes/api';
import { APP_VERSION } from './generated/version';
import { applyUiCatalog } from './core/ui/UiCatalogApplyService';

const app = express();
const port = process.env.PORT || 3001;
const webDist = path.join(__dirname, '../frontend/dist');

app.use(express.json());
app.use('/api', apiRoutes);

app.get('/api/version', (_req, res) => {
  res.json({ success: true, version: APP_VERSION });
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'OK', database: 'connected', service: 'co-CEO Core' });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', database: 'disconnected', error });
  }
});

app.use(express.static(webDist));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'Endpoint não encontrado.' });
  }
  if (req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Frontend não compilado. Execute: npm run build:web');
    }
  });
});

app.listen(port, () => {
  console.log('==========================================');
  console.log(`[co-CEO Core] API + Web na porta ${port}`);
  console.log(`[co-CEO Core] Dev UI: http://localhost:5173 (npm run dev:web)`);
  console.log('==========================================');

  if (process.env.UI_CATALOG_BOOTSTRAP_ON_START !== '0') {
    applyUiCatalog(pool)
      .then((r) => {
        console.log(
          `[co-CEO Core] Catálogo UI sincronizado (textos=${r.textsUpserted}, menu=${r.menuUpserted}).`
        );
      })
      .catch((err) => {
        console.error('[co-CEO Core] Falha ao sincronizar catálogo UI no boot:', err);
      });
  }
});
