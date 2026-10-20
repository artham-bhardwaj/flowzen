import { memo, useEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { usePlayback } from '../app/playback';
import { useValidation } from '../app/validationContext';
import { HOP_AFTER_MISS, HOP_JOB, burstsAt, laneKey, particlesAt } from '../simulation/playback';

/** Upper bound of particles drawn per connection; denser traffic is sampled evenly. */
export const MAX_PARTICLES = 28;
const MAX_BURSTS = 12;
const SVG = 'http://www.w3.org/2000/svg';
const PATH_SAMPLES = 96;

/** Samples a path once so per-frame positions are table lookups (getPointAtLength is slow when called often). */
function samplePath(path: SVGPathElement) {
  const length = path.getTotalLength(); const xs = new Float32Array(PATH_SAMPLES + 1); const ys = new Float32Array(PATH_SAMPLES + 1);
  for (let i = 0; i <= PATH_SAMPLES; i++) { const point = path.getPointAtLength(length * i / PATH_SAMPLES); xs[i] = point.x; ys[i] = point.y; }
  return (progress: number) => {
    const position = Math.max(0, Math.min(1, progress)) * PATH_SAMPLES; const i = Math.min(PATH_SAMPLES - 1, Math.floor(position)); const f = position - i;
    return { x: xs[i] + (xs[i + 1] - xs[i]) * f, y: ys[i] + (ys[i + 1] - ys[i]) * f };
  };
}

function pool(layer: SVGGElement, className: string, count: number) {
  const nodes = layer.querySelectorAll<SVGCircleElement>(`circle.${className}`);
  for (let i = nodes.length; i < count; i++) { const circle = document.createElementNS(SVG, 'circle'); circle.classList.add(className); layer.appendChild(circle); }
  return layer.querySelectorAll<SVGCircleElement>(`circle.${className}`);
}

/**
 * Connection with request particles. Particles are drawn imperatively from the playback store each
 * frame so that animation never re-renders React Flow or touches simulation data.
 */
function FlowEdgeView({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { store, index, travelWindowMs, reducedMotion, selectedRequest, selectRequest } = usePlayback();
  const { validation, showIssues } = useValidation(); const check = validation.edges[laneKey(source, target)];
  const status = check?.status ?? 'unused';
  const { deleteElements } = useReactFlow();
  const wrap = useRef<SVGGElement>(null); const measure = useRef<SVGPathElement>(null); const layer = useRef<SVGGElement>(null); const count = useRef<SVGTextElement>(null);

  useEffect(() => {
    const group = wrap.current!; const particlesLayer = layer.current!; const pathElement = measure.current!; const label = count.current!;
    const lane = index?.lanes[laneKey(source, target)];
    const clear = () => { particlesLayer.replaceChildren(); group.classList.remove('is-active'); label.textContent = ''; };
    if (!lane) { clear(); return; }
    const pointAt = samplePath(pathElement); const middle = pointAt(0.5);
    const draw = () => {
      const time = store.time;
      const { particles, total } = particlesAt(lane, time, travelWindowMs, MAX_PARTICLES, selectedRequest);
      const bursts = burstsAt(lane, time, travelWindowMs, MAX_BURSTS);
      group.classList.toggle('is-active', total > 0);
      const dots = pool(particlesLayer, 'fz-particle', particles.length);
      dots.forEach((dot, i) => {
        const particle = particles[i]; if (!particle) { dot.style.display = 'none'; return; }
        // With reduced motion, requests in transit are summarised as a count at the midpoint instead.
        const point = reducedMotion ? middle : pointAt(particle.progress);
        const pinned = particle.requestId === selectedRequest;
        dot.style.display = reducedMotion && !pinned ? 'none' : '';
        dot.setAttribute('cx', String(point.x)); dot.setAttribute('cy', String(point.y)); dot.setAttribute('r', pinned ? '5.5' : particle.kind === HOP_JOB ? '3.4' : '3');
        dot.setAttribute('class', `fz-particle ${particle.kind === HOP_JOB ? 'kind-job' : particle.kind === HOP_AFTER_MISS ? 'kind-miss' : 'kind-request'}${pinned ? ' is-pinned' : ''}`);
        dot.dataset.request = String(particle.requestId);
      });
      const rings = pool(particlesLayer, 'fz-burst', bursts.length);
      rings.forEach((ring, i) => {
        const burst = bursts[i]; if (!burst) { ring.style.display = 'none'; return; }
        ring.style.display = '';
        ring.setAttribute('cx', String(targetX)); ring.setAttribute('cy', String(targetY));
        ring.setAttribute('r', reducedMotion ? '7' : String(4 + burst.progress * 12));
        ring.style.opacity = reducedMotion ? '0.9' : String(Math.max(0, 1 - burst.progress));
        ring.setAttribute('class', `fz-burst outcome-${burst.cacheHit ? 'hit' : burst.outcome}${burst.requestId === selectedRequest ? ' is-pinned' : ''}`);
        ring.dataset.request = String(burst.requestId);
      });
      label.textContent = reducedMotion && total > 0 ? String(total) : '';
      label.setAttribute('x', String(labelX)); label.setAttribute('y', String(labelY - 8));
    };
    draw();
    const unsubscribe = store.subscribe(draw);
    return () => { unsubscribe(); clear(); };
  }, [index, source, target, path, labelX, labelY, targetX, targetY, travelWindowMs, reducedMotion, selectedRequest, store]);

  return <g ref={wrap} className={`fz-edge edge-${status}${selected ? ' is-selected' : ''}${showIssues && status === 'unused' ? ' is-flagged' : ''}${showIssues && status !== 'unused' ? ' is-dimmed' : ''}`}>
    {check?.reason && <title>{check.reason}</title>}
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
    <path ref={measure} d={path} fill="none" stroke="none" pointerEvents="none" aria-hidden />
    <g ref={layer} className="fz-particles" onClick={event => {
      const requestId = (event.target as SVGElement).dataset?.request;
      if (requestId !== undefined) { event.stopPropagation(); selectRequest(Number(requestId)); }
    }} />
    <text ref={count} className="fz-edge__count" textAnchor="middle" />
    {selected && <EdgeLabelRenderer>
      <button className="fz-edge__remove nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        onClick={() => { void deleteElements({ edges: [{ id }] }); }} aria-label="Remove connection" title="Remove connection (Delete). You can also drag either end of an arrow off a component to detach it.">×</button>
    </EdgeLabelRenderer>}
  </g>;
}
export const FlowEdge = memo(FlowEdgeView);
