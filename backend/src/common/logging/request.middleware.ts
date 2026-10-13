import { randomUUID } from 'crypto';
export function requestMiddleware(req: any, res: any, next: () => void) {
  req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  const start = Date.now();
  res.on('finish', () => {
    if (process.env.LOG_REQUESTS === 'false') return;
    console.log(JSON.stringify({ level: 'info', requestId: req.requestId, method: req.method, url: req.originalUrl?.split('?')[0], status: res.statusCode, ms: Date.now() - start, user: req.user?.id }));
  });
  next();
}
