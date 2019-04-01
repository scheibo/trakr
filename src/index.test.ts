import {Stats, Timer, Tracer, Tracker} from './index';

describe('Tracer', () => {
  test('enabled', () => {
    let tracer = new Tracer();
    expect(tracer.enabled).toBe(false);
    tracer.enable();
    expect(tracer.enabled).toBe(false);
    tracer.disable();
    expect(tracer.enabled).toBe(false);

    const events = {createTracing: jest.fn()};
    const tracing = {enable: jest.fn(), disable: jest.fn(), enabled: true};
    events.createTracing.mockReturnValueOnce(tracing);

    tracer = new Tracer(events);
    expect(tracer.enabled).toBe(false);
    tracer.enable();
    expect(tracer.enabled).toBe(true);
  });

  test('enable', () => {
    const events = {createTracing: jest.fn()};
    const tracing = {enable: jest.fn(), disable: jest.fn(), enabled: false};
    events.createTracing.mockImplementation(() => {
      tracing.enabled = true;
      return tracing;
    });

    const tracer = new Tracer(events);
    tracer.enable();
    tracer.enable();

    expect(tracer.enabled).toBe(true);
    expect(events.createTracing).toHaveBeenCalledWith({
      categories: ['node.perf']
    });
    expect(events.createTracing).toHaveBeenCalledTimes(1);
    expect(tracing.enable).toHaveBeenCalledTimes(1);
  });

  test('disable', () => {
    const events = {createTracing: jest.fn()};
    const tracing = {enable: jest.fn(), disable: jest.fn(), enabled: false};
    events.createTracing.mockImplementation(() => {
      tracing.enabled = true;
      return tracing;
    });

    const tracer = new Tracer(events);
    tracer.enable();
    tracer.disable();
    tracer.disable();

    expect(tracer.enabled).toBe(false);
    expect(tracing.disable).toHaveBeenCalledTimes(1);
  });
});

describe('Tracker', () => {
  test('count', () => {
    const tracker = Tracker.create();
    tracker.count('foo');
    tracker.count('bar', 4);
    tracker.count('foo', 2);

    expect(tracker.counters.get('foo')).toEqual(3);
    expect(tracker.counters.get('bar')).toEqual(4);
    expect(tracker.counters.get('baz')).not.toBeDefined();
  });

  describe('Unbounded', () => {
    test('add', () => {
      const tracker = Tracker.create();
      tracker.add('foo', 10);
      tracker.add('bar', 6);
      tracker.add('foo', 2);

      const foo = tracker.stats().get('foo')!;
      expect(foo.sum).toEqual(12);
      expect(foo.avg).toEqual(6);
      expect(foo.cnt).toEqual(2);

      tracker.add('bar', 20);
      tracker.add('bar', 100);

      const bar = tracker.stats().get('bar')!;
      expect(bar.sum).toEqual(126);
      expect(bar.avg).toEqual(42);
      expect(bar.cnt).toEqual(3);
    });
  });

  describe('Bounded', () => {
    test('add', () => {
      const tracker = Tracker.create({buf: Buffer.allocUnsafe(5 * 9)});
      tracker.add('foo', 10);
      tracker.add('bar', 6);
      tracker.add('foo', 2);

      const foo = tracker.stats().get('foo')!;
      expect(foo.sum).toEqual(12);
      expect(foo.avg).toEqual(6);
      expect(foo.cnt).toEqual(2);

      tracker.add('bar', 20);
      tracker.add('bar', 100);

      const bar = tracker.stats().get('bar')!;
      expect(bar.sum).toEqual(126);
      expect(bar.avg).toEqual(42);
      expect(bar.cnt).toEqual(3);
    });

    test('OOB', () => {
      const tracker = Tracker.create({buf: Buffer.allocUnsafe(1 * 9)});
      tracker.add('foo', 10);
      expect(() => tracker.add('bar', 6)).toThrow();
    });
  });
});

describe('Timer', () => {
  test('count', () => {
    const timer = Timer.create();
    timer.count('foo');
    timer.count('bar', 4);
    timer.count('foo', 2);

    expect(timer.counters.get('foo')).toEqual(3);
    expect(timer.counters.get('bar')).toEqual(4);
    expect(timer.counters.get('baz')).not.toBeDefined();
  });

  test('duration', () => {
    const perf = {now: jest.fn(), mark: jest.fn(), measure: jest.fn()};
    perf.now.mockReturnValueOnce(5).mockReturnValueOnce(15);
    const timer = Timer.create({perf});

    expect(timer.duration).not.toBeDefined();
    timer.time('foo')(0);
    timer.start();
    expect(timer.duration).not.toBeDefined();
    timer.stop();
    timer.time('bar')(0);
    expect(timer.duration).toEqual(10);

    expect(timer.stats().size).toEqual(0);
    expect(perf.now).toHaveBeenCalledTimes(2);
    expect(perf.mark).not.toHaveBeenCalled();
    expect(perf.measure).not.toHaveBeenCalled();
  });

  describe('Basic', () => {
    test('time', () => {
      const perf = {now: jest.fn(), mark: jest.fn(), measure: jest.fn()};
      perf.now.mockReturnValueOnce(11)
          .mockReturnValueOnce(17)
          .mockReturnValueOnce(20);
      const timer = Timer.create({perf});
      timer.start();

      const foo = (a: number) => a + 5;
      const result = timer.time('foo')(foo(2));
      const stats = timer.stats();

      expect(result).toEqual(7);
      expect(stats.size).toEqual(1);
      expect(stats.get('foo')!.sum).toEqual(3);

      expect(perf.mark).not.toHaveBeenCalled();
      expect(perf.measure).not.toHaveBeenCalled();
    });
  });

  describe('Tracing', () => {
    test('time', () => {
      const perf = {now: jest.fn(), mark: jest.fn(), measure: jest.fn()};
      perf.now.mockReturnValueOnce(11)
          .mockReturnValueOnce(17)
          .mockReturnValueOnce(20);
      const timer = Timer.create({perf, trace: true});
      timer.start();

      const foo = (a: number) => a + 5;
      const t = timer.time('foo');
      expect(perf.mark).toHaveBeenCalledWith('b|foo');
      const result = t(foo(2));
      expect(perf.mark).toHaveBeenCalledWith('e|foo');
      const stats = timer.stats();

      expect(result).toEqual(7);
      expect(stats.size).toEqual(1);
      expect(stats.get('foo')!.sum).toEqual(3);

      expect(perf.measure).toHaveBeenCalledWith('foo', 'b|foo', 'e|foo');
    });
  });
});

const POPULATION = true;

describe('Stats', () => {
  test('max', () => {
    expect(Stats.max(array(100))).toEqual(100);
    expect(Stats.max([])).toEqual(-Infinity);
  });

  test('min', () => {
    expect(Stats.min(array(100))).toEqual(1);
    expect(Stats.min([])).toEqual(Infinity);
  });

  test('sum', () => {
    expect(Stats.sum(array(100))).toEqual(100 * 101 / 2);
    expect(Stats.sum([])).toEqual(0);
  });

  test('mean', () => {
    expect(Stats.mean(array(100))).toEqual(50.5);
    expect(Stats.mean([])).toEqual(0);
  });

  test('median', () => {
    expect(Stats.median(array(100))).toEqual(50.5);
    expect(Stats.median([])).toEqual(0);
  });

  test('percentile', () => {
    const arr = array(101);
    expect(Stats.percentile(arr, 0)).toEqual(1);
    expect(Stats.percentile(arr, 0.6)).toEqual(61);
    expect(Stats.percentile(arr, 1.0)).toEqual(101);
    expect(Stats.median([])).toEqual(0);
  });

  test('variance', () => {
    const arr = array(100);
    expect(Stats.variance(arr)).toBeCloseTo(841.67);
    expect(Stats.variance(arr, POPULATION)).toBeCloseTo(833.25);
    expect(Stats.variance([])).toEqual(0);
  });

  test('standardDeviation', () => {
    const arr = array(100);
    expect(Stats.standardDeviation(arr)).toBeCloseTo(29.01);
    expect(Stats.standardDeviation(arr, POPULATION)).toBeCloseTo(28.87);
    expect(Stats.standardDeviation([])).toEqual(0);
  });

  test('standardErrorOfMean', () => {
    const arr = array(100);
    expect(Stats.standardErrorOfMean(arr)).toBeCloseTo(2.901);
    expect(Stats.standardErrorOfMean(arr, POPULATION)).toBeCloseTo(2.887);
    expect(Stats.standardErrorOfMean([])).toEqual(0);
  });

  test('marginOfError', () => {
    const arr = array(100);
    expect(Stats.marginOfError(arr)).toBeCloseTo(5.69);
    expect(Stats.marginOfError(arr, POPULATION)).toBeCloseTo(5.66);
    expect(Stats.marginOfError([])).toEqual(0);
  });

  test('relativeMarginOfError', () => {
    const arr = array(100);
    expect(Stats.relativeMarginOfError(arr)).toBeCloseTo(11.26);
    expect(Stats.relativeMarginOfError(arr, POPULATION)).toBeCloseTo(11.20);
    expect(Stats.relativeMarginOfError([])).toEqual(0);
  });
});

function array(num: number) {
  const arr = new Array(num);
  for (let i = 1; i <= num; i++) {
    arr[i - 1] = i % 2 ? i : num - (i - 2);
  }
  return arr;
}
