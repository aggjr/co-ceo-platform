import type { IRouter, RequestHandler } from 'express';

export type ListedRoute = { method: string; path: string };

/** Lista rotas registradas em um Router Express (1 nível + sub-routers). */
export function listExpressRoutes(router: IRouter, prefix = ''): ListedRoute[] {
  const routes: ListedRoute[] = [];
  const stack = (router as { stack?: unknown[] }).stack;
  if (!stack) return routes;

  for (const layer of stack as Array<{
    route?: { path: string; methods: Record<string, boolean> };
    name?: string;
    handle?: IRouter;
    regexp?: RegExp;
  }>) {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) routes.push({ method: method.toUpperCase(), path });
      }
      continue;
    }
    if (layer.name === 'router' && layer.handle) {
      const segment =
        layer.regexp && layer.regexp.source !== '^\\/?(?=\\/|$)'
          ? prefix + pathFromRegexp(layer.regexp)
          : prefix;
      routes.push(...listExpressRoutes(layer.handle, segment));
    }
  }
  return routes;
}

function pathFromRegexp(regexp: RegExp): string {
  const src = regexp.source
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, ':param');
  return src.startsWith('/') ? src : `/${src}`;
}

export function createApiTestApp(
  mountApi: RequestHandler,
  options?: { spaFallback?: boolean }
): import('express').Express {
  const express = require('express') as typeof import('express');
  const app = express();
  app.use(express.json());
  app.use('/api', mountApi);
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ success: false, error: 'Endpoint não encontrado.' });
    }
    if (options?.spaFallback) {
      return res.status(200).send('spa');
    }
    return next();
  });
  return app;
}

/** Dispara requisição HTTP contra app Express (sem supertest). */
export function httpRequest(
  app: import('express').Express,
  method: string,
  path: string
): Promise<{ status: number; body: Record<string, unknown> | null; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Falha ao abrir porta efêmera'));
      }
      const http = require('http') as typeof import('http');
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path,
          method,
          headers: { Accept: 'application/json' },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            server.close();
            let body: Record<string, unknown> | null = null;
            if (raw) {
              try {
                body = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                body = { raw };
              }
            }
            resolve({ status: res.statusCode ?? 0, body, raw });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}
