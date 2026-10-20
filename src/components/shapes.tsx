import type { LucideIcon } from 'lucide-react';
import { byKind, type Kind } from '../app/catalog';

/**
 * A recognisable outline for every component kind: a cylinder for databases, a memory chip for caches, a pipe for
 * queues, a shield for the WAF, and so on. Shapes are generated in real pixel coordinates for the size they are drawn
 * at, so curves never distort, and each declares the padding its content needs to stay inside the body.
 */
export type ShapeGeometry = {
  /** Filled outline. */
  outline: string;
  /** Layers drawn behind the outline (stacked copies). */
  back?: string[];
  /** Stroke-only decoration drawn on top (rims, ribs, folds). */
  detail?: string;
  /** Heavier decoration (a magnifier handle). */
  accent?: string;
  /** Content padding: top, right, bottom, left. */
  pad: [number, number, number, number];
};

const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;

/** Geometry for a kind at a size. `u` scales the fixed details so small glyphs keep their character. */
export function shapeGeometry(kind: Kind, w: number, h: number): ShapeGeometry {
  const u = Math.max(0.32, Math.min(1, h / 80));
  const a = 1; const W = w - 1; const H = h - 1; // half-pixel inset for the stroke
  switch (kind) {
    case 'client': { // monitor on a stand
      const body = H - 12 * u;
      return { outline: `${rect(a, a, W - a, body - a, 7 * u)} M${w / 2 - 10 * u},${body} L${w / 2 - 14 * u},${H} H${w / 2 + 14 * u} L${w / 2 + 10 * u},${body} Z`, detail: `M${a + 5 * u},${body - 6 * u} H${W - 5 * u}`, pad: [10, 12, 22, 12] };
    }
    case 'dns': return { outline: rect(a, a, W - a, H - a, (H - a) / 2), detail: `M${h / 2},${a + 4 * u} V${H - 4 * u}`, pad: [10, 18, 11, 22] };
    case 'cdn': { // cloud: bumps along the top
      const top = 12 * u; const r = 9 * u;
      return { outline: `M${a + r},${H} Q${a},${H} ${a},${H - r} V${top + r} Q${a},${top} ${a + r},${top} Q${w * 0.18},${a} ${w * 0.32},${top * 0.75} Q${w * 0.5},${-top * 0.2} ${w * 0.66},${top * 0.75} Q${w * 0.82},${a} ${W - r},${top} Q${W},${top} ${W},${top + r} V${H - r} Q${W},${H} ${W - r},${H} Z`, pad: [18, 12, 11, 12] };
    }
    case 'loadBalancer': { // pointed intake, forked outputs
      const p = 12 * u; const n = 7 * u;
      return { outline: `M${a + p},${a} H${W} L${W - n},${h / 3} L${W},${h / 2} L${W - n},${(2 * h) / 3} L${W},${H} H${a + p} L${a},${h / 2} Z`, pad: [10, 18, 11, 18] };
    }
    case 'reverseProxy': { const p = 12 * u; return { outline: `M${a + p},${a} H${W - p} L${W},${h / 2} L${W - p},${H} H${a + p} L${a},${h / 2} Z`, detail: `M${a + p + 4 * u},${a + 3 * u} L${a + 5 * u},${h / 2} L${a + p + 4 * u},${H - 3 * u}`, pad: [10, 16, 11, 20] }; }
    case 'gateway': { const t = 14 * u; return { outline: `M${a},${H} V${t + 8 * u} C${a},${a} ${w * 0.25},${a} ${w / 2},${a} C${w * 0.75},${a} ${W},${a} ${W},${t + 8 * u} V${H} Z`, detail: `M${a},${H - 4 * u} H${W}`, pad: [16, 12, 14, 12] }; }
    case 'waf': { const s = H * 0.62; return { outline: `M${a},${a} H${W} V${s} Q${W},${H - 6 * u} ${w / 2},${H} Q${a},${H - 6 * u} ${a},${s} Z`, detail: `M${a + 6 * u},${a + 5 * u} H${W - 6 * u}`, pad: [12, 14, 20, 14] }; }
    case 'server': { // rack unit with drive bays
      const y1 = H - 14 * u; const y2 = H - 7 * u;
      return { outline: rect(a, a, W - a, H - a, 5 * u), detail: `M${a},${y1} H${W} M${W - 30 * u},${y2} H${W - 10 * u} M${a + 8 * u},${y2} H${a + 11 * u} M${a + 15 * u},${y2} H${a + 18 * u}`, pad: [10, 12, 20, 12] };
    }
    case 'containerService': { // corrugated shipping container
      const ribs: string[] = []; for (let x = a + 14 * u; x < W - 8 * u; x += 12 * u) ribs.push(`M${x},${a} V${a + 5 * u} M${x},${H} V${H - 5 * u}`);
      return { outline: rect(a, a, W - a, H - a, 2), detail: `${ribs.join(' ')} M${a + 4 * u},${a} V${H} M${W - 4 * u},${a} V${H}`, pad: [11, 14, 11, 14] };
    }
    case 'serverless': { const k = 12 * u; return { outline: `M${a + k},${a} H${W} L${W - k},${H} H${a} Z`, pad: [10, 20, 11, 20] }; }
    case 'worker': { // gear teeth top and bottom
      const t = 5 * u; const step = 26 * u; const tw = 9 * u; let top = `M${a},${a + t}`; let bottom = '';
      for (let x = a + 12 * u; x + tw < W - 8 * u; x += step) top += ` H${x} V${a} H${x + tw} V${a + t}`;
      top += ` H${W} V${H - t}`;
      const xs: number[] = []; for (let x = a + 12 * u; x + tw < W - 8 * u; x += step) xs.push(x);
      for (const x of xs.reverse()) bottom += ` H${x + tw} V${H} H${x} V${H - t}`;
      return { outline: `${top}${bottom} H${a} Z`, pad: [14, 12, 15, 12] };
    }
    case 'database': case 'readReplica': { // a cylinder; a replica is a copy stacked behind another
      const ry = 7 * u; const o = kind === 'readReplica' ? 6 * u : 0;
      const cyl = (x0: number, x1: number, dy: number) => { const rx = (x1 - x0) / 2; return `M${x0},${ry + dy} A${rx},${ry} 0 0 1 ${x1},${ry + dy} V${H - ry + dy} A${rx},${ry} 0 0 1 ${x0},${H - ry + dy} Z`; };
      const rx = (W - o - a) / 2;
      return {
        outline: cyl(a, W - o, 0),
        back: o ? [cyl(a + o, W, -o / 2)] : undefined,
        detail: `M${a},${ry} A${rx},${ry} 0 0 0 ${W - o},${ry}`,
        pad: [ry * 2 + 6, 12 + o, ry + 6, 12],
      };
    }
    case 'nosql': { // stacked documents with a folded corner
      const f = 12 * u; const o = 5 * u;
      return { outline: `M${a},${a + o} H${W - o - f} L${W - o},${a + o + f} V${H} H${a} Z`, back: [`M${a + o},${a} H${W} V${H - o}`], detail: `M${W - o - f},${a + o} V${a + o + f} H${W - o}`, pad: [12, 18, 10, 12] };
    }
    case 'objectStorage': { // bucket with a rim
      const ry = 6 * u; const k = 9 * u;
      return { outline: `M${a},${ry} A${(W - a) / 2},${ry} 0 0 1 ${W},${ry} L${W - k},${H} H${a + k} Z`, detail: `M${a},${ry} A${(W - a) / 2},${ry} 0 0 0 ${W},${ry}`, pad: [ry * 2 + 6, 16, 9, 16] };
    }
    case 'searchEngine': { // magnifier lens with a handle
      const hx = 12 * u; const hy = 10 * u;
      return { outline: rect(a, a, W - a - hx, H - a - hy, Math.min(16 * u, (H - hy) / 2)), accent: `M${W - hx - 6 * u},${H - hy - 4 * u} L${W - 2},${H - 2}`, pad: [10, 20, 18, 12] };
    }
    case 'cache': { // memory chip with pins
      const pin = 5 * u; const body = H - pin; const pins: string[] = [];
      for (let x = a + 10 * u; x < W - 10 * u; x += 11 * u) pins.push(`M${x},${body} V${H}`);
      return { outline: rect(a, a, W - a, body - a, 3), detail: `${pins.join(' ')} M${w / 2 - 5 * u},${body} A${5 * u},${4 * u} 0 0 1 ${w / 2 + 5 * u},${body}`, pad: [10, 12, 14, 12] };
    }
    case 'distributedCache': { // a cluster of stacked chips
      const o = 5 * u;
      return { outline: rect(a, a + 2 * o, W - a - 2 * o, H - a - 2 * o, 3), back: [rect(a + 2 * o, a, W - a - 2 * o, H - a - 2 * o, 3), rect(a + o, a + o, W - a - 2 * o, H - a - 2 * o, 3)], pad: [18, 22, 10, 12] };
    }
    case 'queue': { // a pipe with message slots
      const e = 8 * u; const r = (H - a) / 2;
      const slots: string[] = []; for (let i = 1; i <= 3; i++) slots.push(`M${W - e - i * 7 * u},${a + 3 * u} V${H - 3 * u}`);
      return { outline: `M${a + e},${a} H${W - e} A${e},${r} 0 0 1 ${W - e},${H} H${a + e} A${e},${r} 0 0 1 ${a + e},${a} Z`, detail: `M${W - e},${a} A${e},${r} 0 0 0 ${W - e},${H} ${slots.join(' ')}`, pad: [10, 36, 11, 16] };
    }
    case 'eventStream': { // a ribbon of log tape
      const p = 11 * u; const dots: string[] = []; for (let x = a + 16 * u; x < W - 16 * u; x += 10 * u) dots.push(`M${x},${a + 3.5 * u} h${2 * u}`);
      return { outline: `M${a},${a} H${W - p} L${W},${h / 2} L${W - p},${H} H${a} L${a + p},${h / 2} Z`, detail: dots.join(' '), pad: [11, 18, 11, 18] };
    }
    case 'deadLetterQueue': { // archive box with a lid
      const lid = 11 * u; const k = 4 * u;
      return { outline: `M${a},${a} H${W} V${lid} H${W - k} V${H} H${a + k} V${lid} H${a} Z`, detail: `M${a + k},${lid} H${W - k} M${w / 2 - 10 * u},${lid + 6 * u} H${w / 2 + 10 * u}`, pad: [lid + 8, 12, 9, 12] };
    }
    case 'rateLimiter': { const k = 18 * u; return { outline: `M${a},${a} H${W} L${W - k},${H} H${a + k} Z`, detail: `M${a + 6 * u},${a + 6 * u} H${W - 6 * u}`, pad: [12, 22, 11, 22] }; }
    case 'circuitBreaker': { // fuse with zig-zag terminals
      const k = 7 * u;
      return { outline: `M${a + k},${a} H${W - k} L${W},${h * 0.25} L${W - k},${h * 0.5} L${W},${h * 0.75} L${W - k},${H} H${a + k} L${a},${h * 0.75} L${a + k},${h * 0.5} L${a},${h * 0.25} Z`, pad: [10, 16, 11, 16] };
    }
    case 'metricsCollector': { // chart frame with a sparkline
      const base = H - 6 * u; const pts = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((t, i) => `${a + 8 * u + t * (W - 16 * u)},${base - [3, 7, 4, 9, 6, 11, 8][i] * u}`);
      return { outline: rect(a, a, W - a, H - a, 4), detail: `M${pts.join(' L')}`, pad: [10, 12, 20, 12] };
    }
    case 'logAggregator': { // scroll with curled corners
      const c = 10 * u;
      return { outline: `M${a + c},${a} H${W} V${H - c} A${c},${c} 0 0 1 ${W - c},${H} H${a} V${a + c} A${c},${c} 0 0 1 ${a + c},${a} Z`, detail: `M${a + c},${a} A${c / 2},${c / 2} 0 0 0 ${a + c},${a + c} H${a} M${W - c},${H} A${c / 2},${c / 2} 0 0 0 ${W - c},${H - c} H${W}`, pad: [12, 14, 12, 14] };
    }
  }
}

/** Short descriptions of what each outline depicts (shown in tooltips and guides). */
export const SHAPE_NAMES: Record<Kind, string> = {
  client: 'a monitor', dns: 'an address pill', cdn: 'a cloud', loadBalancer: 'a splitter with forked outputs', reverseProxy: 'a two-way arrow',
  gateway: 'an archway', waf: 'a shield', server: 'a server rack', containerService: 'a shipping container', serverless: 'a slanted function tab',
  worker: 'a gear', database: 'a cylinder', readReplica: 'a copied cylinder', nosql: 'a stack of documents', objectStorage: 'a bucket',
  searchEngine: 'a magnifier', cache: 'a memory chip', distributedCache: 'a cluster of memory chips', queue: 'a pipe of messages', eventStream: 'a log tape',
  deadLetterQueue: 'an archive box', rateLimiter: 'a funnel', circuitBreaker: 'a fuse', metricsCollector: 'a chart', logAggregator: 'a scroll',
};

/** The outline as SVG, sized to its container (for nodes) or to a fixed box (for glyphs). */
export function ShapeSvg({ kind, width, height, className = '' }: { kind: Kind; width: number; height: number; className?: string }) {
  if (width <= 0 || height <= 0) return null;
  const geometry = shapeGeometry(kind, width, height);
  return <svg className={`fz-shape ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
    {geometry.back?.map((d, i) => <path key={i} d={d} className="fz-shape__back" />)}
    <path d={geometry.outline} className="fz-shape__outline" />
    {geometry.detail && <path d={geometry.detail} className="fz-shape__detail" />}
    {geometry.accent && <path d={geometry.accent} className="fz-shape__accent" />}
  </svg>;
}

/** A small badge: the component's outline with its icon inside. Used in the library, cards, guides and lists. */
export function ShapeGlyph({ kind, size = 34, icon }: { kind: Kind; size?: number; icon?: LucideIcon }) {
  const item = byKind[kind]; const Icon = icon ?? item.icon; const width = Math.round(size * 1.3);
  return <span className={`fz-glyph cat-${item.category}`} style={{ width, height: size }} title={`${item.label}: drawn as ${SHAPE_NAMES[kind]}`}>
    <ShapeSvg kind={kind} width={width} height={size} />
    <Icon size={Math.round(size * 0.42)} strokeWidth={1.9} aria-hidden />
  </span>;
}
