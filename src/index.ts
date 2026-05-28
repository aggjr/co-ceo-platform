import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import pool from './config/database';
import apiRoutes from './routes/api';
import { GatewayError } from './core/dal';
import { APP_VERSION } from './generated/version';
import { ensureCoreSchema } from './core/db/ensureCoreSchema';
import { applyUiCatalog } from './core/ui/UiCatalogApplyService';
import { startInvestMarketCron } from './jobs/investMarketCron';

const app = express();
const port = process.env.PORT || 3001;
const webDist = path.join(__dirname, '../frontend/dist');

app.use(express.json({ limit: '30mb' }));
app.use('/api', apiRoutes);

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  
  // Catch express.json() parsing errors
  if (err instanceof SyntaxError && 'status' in (err as any) && (err as any).status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'JSON inválido enviado na requisição.' });
  }

  console.error('[co-CEO Core] Erro na API:', err);
  if (err instanceof GatewayError) {
    return res.status(err.httpStatus).json({ success: false, error: err.message });
  }
  const message = err instanceof Error ? err.message : 'Erro interno do servidor.';
  return res.status(500).json({ success: false, error: message });
});

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

async function startServer() {
  try {
    const r = await ensureCoreSchema(pool);
    if (r.marketMigrationApplied || r.platformJobMigrationApplied) {
      console.log(
        `[co-CEO Core] Schema core aplicado (mercado=${r.marketMigrationApplied}, jobs=${r.platformJobMigrationApplied}).`
      );
    }
  } catch (err) {
    console.error('[co-CEO Core] Falha ao garantir schema core:', err);
  }

  app.listen(port, () => {
    console.log('==========================================');
    console.log(`[co-CEO Core] API + Web na porta ${port}`);
    console.log(`[co-CEO Core] Dev UI: http://localhost:5173 (npm run dev:web)`);
    console.log('==========================================');

    startInvestMarketCron();

    if (process.env.UI_CATALOG_BOOTSTRAP_ON_START === '1') {
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
}

void startServer();
