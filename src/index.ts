// tslint:disable-next-line:no-any
const IDENTITY = (a: any) => a;

interface Performance {
  now(): number;
  mark(name: string): void;
  measure(name: string, startMark: string, endMark: string): void;
}

interface Tracing {
  enable(): void;
  disable(): void;
  readonly enabled: boolean;
}

interface TraceEvents {
  createTracing(options: {categories: string[]}): Tracing;
}

const NODE = typeof module !== 'undefined' && module.exports;
// @ts-ignore
const PERF: Performance = (NODE ? require('perf_hooks') : window).performance;

export class Tracer {
  readonly traceEvents?: TraceEvents;
  tracing?: Tracing;

  constructor(traceEvents?: TraceEvents) {
    this.traceEvents = traceEvents;
  }

  get enabled() {
    return !!(this.tracing && this.tracing.enabled);
  }

  enable(categories?: string[]) {
    if (!this.traceEvents || this.enabled) return;
    categories = categories || ['node.perf'];
    this.tracing = this.traceEvents.createTracing({categories});
    this.tracing.enable();
  }

  disable() {
    if (!this.tracing || !this.enabled) return;
    this.tracing.disable();
    this.tracing = undefined;
  }
}
export const TRACER = new Tracer(NODE && require('trace_events'));

export interface TrackerOptions {
  buf?: Buffer;
}

export abstract class Tracker {
  static create(options?: TrackerOptions) {
    const buf = options && options.buf;
    return buf ? new BoundedTracker(buf) : new UnboundedTracker();
  }

  readonly counters: Map<string, number>;

  constructor() {
    this.counters = new Map();
  }

  count(name: string, val?: number) {
    val = val || 1;
    const c = this.counters.get(name);
    this.counters.set(name, typeof c !== 'undefined' ? (c + val) : val);
  }

  abstract add(name: string, val: number): void;
  abstract stats(sample?: boolean): Map<string, Stats>;

  protected push(dists: Map<string, number[]>, name: string, val: number) {
    const d = dists.get(name) || [];
    if (!d.length) dists.set(name, d);
    d.push(val);
  }

  // T(M, N): M(N lg N + 3N)
  protected compute(dists: Map<string, number[]>, sample?: boolean) {
    const stats = new Map();
    for (const [name, vals] of dists.entries()) {
      stats.set(name, Stats.compute(vals, sample));
    }
    return stats;
  }
}

class UnboundedTracker extends Tracker {
  protected readonly distributions: Map<string, number[]>;

  constructor() {
    super();
    this.distributions = new Map();
  }

  add(name: string, val: number) {
    return this.push(this.distributions, name, val);
  }

  stats(sample?: boolean): Map<string, Stats> {
    return this.compute(this.distributions, sample);
  }
}

class BoundedTracker extends Tracker {
  protected readonly buf: Buffer;
  protected readonly next: {tag: number, loc: number, dloc: number};
  protected readonly tags: Map<string, number>;
  protected readonly distributions: Map<string, number[]>;

  constructor(buf: Buffer) {
    super();
    this.buf = buf;
    this.next = {tag: 0, loc: 0, dloc: 0};
    this.tags = new Map();
    this.distributions = new Map();
  }

  add(name: string, val: number) {
    let tag = this.tags.get(name);
    if (typeof tag === 'undefined') {
      this.tags.set(name, (tag = this.next.tag++));
    }
    this.buf.writeUInt8(tag, this.next.loc);
    this.buf.writeDoubleBE(val, this.next.loc + 1);
    this.next.loc += 9;
  }

  stats(sample?: boolean): Map<string, Stats> {
    if (this.next.dloc !== this.next.loc) {
      const names: string[] = [];
      for (const [name, tag] of this.tags.entries()) {
        names[tag] = name;
      }

      while (this.next.dloc < this.next.loc) {
        const name = names[this.buf.readUInt8(this.next.dloc)];
        const val = this.buf.readDoubleBE(this.next.dloc + 1);
        this.push(this.distributions, name, val);
        this.next.dloc += 9;
      }
    }
    return this.compute(this.distributions, sample);
  }
}

export interface TimerOptions extends TrackerOptions {
  trace?: boolean;
  perf?: Performance;
}

export abstract class Timer {
  static create(options?: TimerOptions) {
    const tracker = Tracker.create(options);
    const perf = (options && options.perf) || PERF;
    const trace = (options && typeof options.trace !== 'undefined') ?
        !!options.trace :
        TRACER.enabled;
    return trace ? new TracingTimer(tracker, perf) :
                   new BasicTimer(tracker, perf);
  }

  protected readonly tracker: Tracker;
  protected readonly perf: Performance;
  protected started?: number;
  protected stopped?: number;

  constructor(tracker: Tracker, perf: Performance) {
    this.tracker = tracker;
    this.perf = perf;
  }

  count(name: string, val?: number) {
    this.tracker.count(name, val);
  }

  get counters(): Map<string, number> {
    return this.tracker.counters;
  }

  get duration(): number|undefined {
    if (typeof this.started === 'undefined' ||
        typeof this.stopped === 'undefined') {
      return undefined;
    }
    return this.stopped - this.started;
  }

  start() {
    if (!this.started) this.started = this.perf.now();
  }

  stop() {
    if (!this.stopped) this.stopped = this.perf.now();
  }

  stats(sample?: boolean): Map<string, Stats> {
    return this.tracker.stats(sample);
  }

  // tslint:disable-next-line:no-any
  abstract time(name: string): (a: any) => any;
}

class BasicTimer extends Timer {
  constructor(tracker: Tracker, perf: Performance) {
    super(tracker, perf);
  }

  time(name: string) {
    if (!this.started || this.stopped) return IDENTITY;
    const begin = this.perf.now();
    // tslint:disable-next-line:no-any
    return (a: any) => {
      this.tracker.add(name, this.perf.now() - begin);
      return a;
    };
  }
}

class TracingTimer extends Timer {
  constructor(tracker: Tracker, perf: Performance) {
    super(tracker, perf);
  }

  time(name: string) {
    if (!this.started || this.stopped) return IDENTITY;

    const b = `b|${name}`;
    this.perf.mark(b);
    const begin = this.perf.now();

    // tslint:disable-next-line:no-any
    return (a: any) => {
      this.tracker.add(name, this.perf.now() - begin);

      const e = `e|${name}`;
      this.perf.mark(e);
      this.perf.measure(name, b, e);
      return a;
    };
  }
}

// clang-format off
export interface Stats {
  readonly cnt: number;
  readonly sum: number;
  readonly avg: number;
  readonly var: number;
  readonly std: number;
  readonly sem: number;
  readonly moe: number;
  readonly rme: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}
// clang-format on

// T-Distribution two-tailed critical values for 95% confidence.
// http://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm.
const TABLE = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201,  2.179, 2.16,  2.145, 2.131, 2.12,  2.11,  2.101, 2.093, 2.086,
  2.08,   2.074, 2.069, 2.064, 2.06,  2.056, 2.052, 2.048, 2.045, 2.042,
];
const TINF = 1.96;

export class Stats {
  protected constructor() {}

  // T(N): N lg N + 4N
  static compute(arr: number[], sample?: boolean): Stats {
    const sorted = arr.slice();    // N
    sorted.sort((a, b) => a - b);  // N lg N

    const sum = Stats.sum(sorted);  // N
    const mean = Stats.mean(arr, sum);
    const variance = Stats.variance(arr, sample, mean);  // 2N
    const stddev = Math.sqrt(variance);
    const error = Stats.standardErrorOfMean(sorted, sample, stddev);
    const margin = Stats.marginOfError(sorted, sample, error);

    // clang-format off
    return {
      cnt: sorted.length,
      sum,
      avg: mean,
      var : variance,
      std: stddev,
      sem: error,
      moe: margin,
      rme: Stats.relativeMarginOfError(sorted, sample, margin, mean),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: Stats.ptile(sorted, 0.50),
      p90: Stats.ptile(sorted, 0.90),
      p95: Stats.ptile(sorted, 0.95),
      p99: Stats.ptile(sorted, 0.99),
    };
    // clang-format on
  }

  // T(N): N
  static max(arr: number[]): number {
    let m = -Infinity;
    for (const a of arr) {
      if (a > m) m = a;
    }
    return m;
  }

  // T(N): N
  static min(arr: number[]): number {
    let m = Infinity;
    for (const a of arr) {
      if (a < m) m = a;
    }
    return m;
  }

  // T(N): N
  static sum(arr: number[]): number {
    if (!arr.length) return 0;
    return arr.reduce((acc, v) => acc + v);
  }

  // T(N): N | 1
  static mean(arr: number[], sum?: number): number {
    if (!arr.length) return 0;
    const s = typeof sum !== 'undefined' ? sum : Stats.sum(arr);
    return s / arr.length;
  }

  // T(N): N lg N
  static median(arr: number[]): number {
    return Stats.percentile(arr, 0.5);
  }

  // T(N): N lg N + N
  static percentile(arr: number[], p: number): number {
    const sorted = arr.slice();
    sorted.sort((a, b) => a - b);
    return Stats.ptile(sorted, p);
  }

  // PRE: arr = arr.sort((a, b) => a - b)
  private static ptile(arr: number[], p: number): number {
    if (!arr.length) return 0;
    if (p <= 0) return arr[0];
    if (p >= 1) return arr[arr.length - 1];

    const index = (arr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = lower + 1;
    const weight = index % 1;

    if (upper >= arr.length) return arr[lower];
    return arr[lower] * (1 - weight) + arr[upper] * weight;
  }

  // T(N): 3N | 2N
  static variance(arr: number[], sample?: boolean, mean?: number): number {
    if (!arr.length) return 0;
    const n = !!sample ? arr.length - 1 : arr.length;
    const m = typeof mean !== 'undefined' ? mean : Stats.mean(arr);
    return Stats.sum(arr.map(num => Math.pow(num - m, 2))) / n;
  }

  // T(N): 3N | 2N
  static standardDeviation(arr: number[], sample?: boolean, mean?: number):
      number {
    return Math.sqrt(Stats.variance(arr, sample, mean));
  }

  // T(N): 3N | 1
  static standardErrorOfMean(arr: number[], sample?: boolean, std?: number) {
    if (!arr.length) return 0;
    const dev =
        typeof std !== 'undefined' ? std : Stats.standardDeviation(arr, sample);
    return dev / Math.sqrt(arr.length);
  }

  // T(N): 3N | 1
  static marginOfError(arr: number[], sample?: boolean, sem?: number) {
    if (!arr.length) return 0;
    const err = typeof sem !== 'undefined' ?
        sem :
        Stats.standardErrorOfMean(arr, sample);
    return err * (TABLE[(arr.length - 1) - 1] || TINF);
  }

  // T(N): 4N | 1
  static relativeMarginOfError(
      arr: number[], sample?: boolean, moe?: number, mean?: number) {
    if (!arr.length) return 0;
    const margin =
        typeof moe !== 'undefined' ? moe : Stats.marginOfError(arr, sample);
    const avg = typeof mean !== 'undefined' ? mean : Stats.mean(arr);
    return (margin / avg) * 100;
  }
}
