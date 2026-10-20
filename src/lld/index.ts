import type { Kind } from '../app/catalog';
import type { LldModel } from './types';
import { loadBalancerModel } from './models/loadBalancer';
import { gatewayModel } from './models/gateway';
import { appServerModel } from './models/appServer';
import { cacheModel } from './models/cache';
import { databaseModel } from './models/database';
import { queueModel } from './models/queue';
import { workerModel } from './models/worker';
import { rateLimiterModel } from './models/rateLimiter';
import { circuitBreakerModel } from './models/circuitBreaker';

/** Every component kind with a low-level design. Other kinds show an explicit "not covered yet" state. */
export const LLD_MODELS: LldModel[] = [
  loadBalancerModel, gatewayModel, appServerModel, cacheModel, databaseModel, queueModel, workerModel, rateLimiterModel, circuitBreakerModel,
];

const byKind = new Map<Kind, LldModel>(LLD_MODELS.flatMap(model => model.kinds.map(kind => [kind, model] as const)));
export const lldModelFor = (kind: Kind): LldModel | undefined => byKind.get(kind);
export const hasLld = (kind: Kind) => byKind.has(kind);
