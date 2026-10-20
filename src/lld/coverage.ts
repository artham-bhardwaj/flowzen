import type { Kind } from '../app/catalog';

/**
 * Lightweight index of which kinds have a low-level design, so the canvas and inspector can show
 * coverage without loading the (large) models. `lld.test.ts` checks it matches `LLD_MODELS`.
 */
export const LLD_COVERAGE: Partial<Record<Kind, { title: string; types: number }>> = {
  loadBalancer: { title: 'Load Balancer', types: 10 },
  gateway: { title: 'API Gateway', types: 11 },
  server: { title: 'Application Server', types: 9 },
  cache: { title: 'Cache', types: 9 },
  database: { title: 'SQL Database (data access)', types: 7 },
  queue: { title: 'Message Queue', types: 9 },
  worker: { title: 'Worker', types: 7 },
  rateLimiter: { title: 'Rate Limiter', types: 7 },
  circuitBreaker: { title: 'Circuit Breaker', types: 9 },
};
export const hasLldDesign = (kind: Kind) => kind in LLD_COVERAGE;
