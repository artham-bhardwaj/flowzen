import { byKind, type Kind } from '../app/catalog';
import type { FlowEdge, FlowNode } from '../app/model';

/**
 * Structural experiment edits. Pure: they return new node and edge arrays, and the app applies them as one
 * undoable canvas edit. Only edits the simulator models are offered.
 */
const ROUTERS: ReadonlySet<Kind> = new Set(['loadBalancer', 'reverseProxy']);
export const REPLICABLE: ReadonlySet<Kind> = new Set(['server', 'containerService', 'serverless']);

/** Whether a compute node is behind a router that spreads traffic across replicas (a single entry point would bypass a replica). */
export const canAddReplica = (nodes: FlowNode[], edges: FlowEdge[], id: string) => {
  const node = nodes.find(entry => entry.id === id); if (!node || !REPLICABLE.has(node.data.kind)) return false;
  const kinds = new Map(nodes.map(entry => [entry.id, entry.data.kind]));
  return edges.some(edge => edge.target === id && ROUTERS.has(kinds.get(edge.source)!));
};

/** Adds a copy of a compute node behind the same routers, with the same downstream connections. */
export function addReplica(nodes: FlowNode[], edges: FlowEdge[], id: string, newId: string): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const source = nodes.find(node => node.id === id);
  if (!source || !canAddReplica(nodes, edges, id) || nodes.some(node => node.id === newId)) return null;
  const kinds = new Map(nodes.map(entry => [entry.id, entry.data.kind]));
  const replicas = nodes.filter(node => node.data.kind === source.data.kind).length;
  const copy: FlowNode = {
    id: newId, type: 'architecture', position: { x: source.position.x, y: source.position.y + 150 }, selected: false,
    data: { label: `${source.data.label} (replica ${replicas + 1})`, kind: source.data.kind, config: { ...source.data.config } },
  };
  const incoming = edges.filter(edge => edge.target === id && ROUTERS.has(kinds.get(edge.source)!)).map(edge => ({ id: `${edge.source}-${newId}`, source: edge.source, target: newId, type: 'flow' }));
  const outgoing = edges.filter(edge => edge.source === id).map(edge => ({ id: `${newId}-${edge.target}`, source: newId, target: edge.target, type: 'flow' }));
  return { nodes: [...nodes.map(node => node.selected ? { ...node, selected: false } : node), copy], edges: [...edges, ...incoming, ...outgoing] };
}

const STORES: ReadonlySet<Kind> = new Set(['database', 'nosql', 'objectStorage', 'searchEngine']);
const CACHES: ReadonlySet<Kind> = new Set(['cache', 'distributedCache', 'cdn']);
/** A store can get a cache in front when something other than a cache sends requests to it. */
export const canInsertCache = (nodes: FlowNode[], edges: FlowEdge[], id: string) => {
  const node = nodes.find(entry => entry.id === id); if (!node || !STORES.has(node.data.kind)) return false;
  const kinds = new Map(nodes.map(entry => [entry.id, entry.data.kind]));
  return edges.some(edge => edge.target === id && !CACHES.has(kinds.get(edge.source)!));
};

/** Routes every non-cache caller of a store through one new Cache placed in front of it. */
export function insertCacheBefore(nodes: FlowNode[], edges: FlowEdge[], id: string, newId: string): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const store = nodes.find(node => node.id === id);
  if (!store || !canInsertCache(nodes, edges, id) || nodes.some(node => node.id === newId)) return null;
  const kinds = new Map(nodes.map(entry => [entry.id, entry.data.kind]));
  const callers = edges.filter(edge => edge.target === id && !CACHES.has(kinds.get(edge.source)!));
  const cache: FlowNode = { id: newId, type: 'architecture', position: { x: store.position.x - 140, y: store.position.y - 130 }, selected: false, data: { label: `Cache for ${store.data.label}`, kind: 'cache', config: { ...byKind.cache.defaults } } };
  const rerouted = edges.filter(edge => !callers.includes(edge));
  const callerIds = [...new Set(callers.map(edge => edge.source))];
  return {
    nodes: [...nodes, cache],
    edges: [...rerouted, ...callerIds.map(source => ({ id: `${source}-${newId}`, source, target: newId, type: 'flow' })), { id: `${newId}-${id}`, source: newId, target: id, type: 'flow' }],
  };
}
