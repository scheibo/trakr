# trakr
[![npm version](https://img.shields.io/npm/v/trakr.svg)](https://www.npmjs.com/package/trakr)&nbsp;
[![Build Status](https://api.travis-ci.org/scheibo/trakr.svg)](https://travis-ci.org/scheibo/trakr)&nbsp;
[![Dependencies](https://img.shields.io/david/scheibo/trakr-node.svg)](https://david-dm.org/scheibo/trakr)

trakr is a minimal library for tracking performance in Javascript applications
in Node or in the browser.

## API

-   **`Tracer`**: Can be used to `enable` or `disable` trace event collection in
    Node programatically. If tracing is `enabled` through trakr's `TRACER`,
    created `Timer` objects will record trace events by default. If trace event
    collection is enabled via a flag (eg. '`node ---trace-event-categories
    node.perf`') or through `chrome://tracing` on Web, `Timer` needs to be
    explicitly told to create trace events (see below).

    ```javascript
    import {TRACER, Timer} from 'trakr';

    TRACER.enable(); // enables 'node.perf' category by default
    const timer = Timer.create();
    // create a 'foo' section in the trace event timeline as well as recording
    timer.time('foo')(foo());
    ```

-   **`Tracker`**: Can be used to `count` occurences of specific events or `add`
    values to arbitrary distributions. Currently, trakr offers *bounded* and
    *unbounded* options for tracking distributions - if a `Buffer` is passed in
    the `Tracker` will use only the memory it is provided to record its values
    (plus additional memory for each key), otherwise trakr will record every
    value `add`-ed to it. In the future, trakr may provide a sampled option (eg.
    utilizing [reservoir sampling][1]), but currently prioritizes 100% accurate
    data with the lowest possible CPU cost for local benchmarking purposes.

    If using the bounded option (recommended for performance to avoid
    allocations/GC due to array resizing during benchmarking), allocate enough
    space in the provide `Buffer` to handle 9 bytes of buffer space for each
    added value (1 byte for a tag and 8 bytes for the float value).

    ```javascript
    import {Tracker} from 'trakr';

    const tracker = Tracker.create({buf: Buffer.alloc(1024)});
    tracker.count('foo');
    tracker.count('foo', 5);
    console.log(tracker.counters.foo); // => 6

    tracker.add('bar', 10);
    tracker.add('bar', 20);
    console.log(tracker.stats().get('bar').avg) // => 15
    ```

-   **`Timer`**: Similar to `Tracker`, `Timer` allows for not only keeping track
    of various `count`s, but also for being able to `time` various sections of
    code. The `Timer` can be bounded or unbounded like with `Tracker`, and can
    also be configured to create trace events or not (see `Tracer`). The `Timer`
    aims to add minimal overhead to the code it is measuring - until it is
    `start`-ed (or after `stop` is called), it will do nothing, and by providing
    a preallocated `Buffer`, minimal memory churn should occur to skew the
    benchmarks. However minimal, the overhead added by the `Timer` is real, so
    care should be taken before reading too much into the results of small,
    frequently called functions which have been instrumented. Enabling tracing
    (`{trace: true}`) increases the overhead dramatically (writing to the
    `Performance` timing buffer and allocating strings for the section marks and
    names are expensive for frequent operations) - the `stats` from a
    tracing-enabled run are expected to diverge considerably from the actual
    performance.

    ```javascript
    import {Timer} from 'trakr';

    const timer = Timer.create();
    const end = timer.time('foo');
    ...
    end(); // time between `time` call and now

    const t = timer.time('bar');
    t(bar()); // time between `time` call and when `bar` completes

    const t2 = timer.time('baz');
    baz().finally(t2); // time between `time` call and when a Promise resolves
    ```

-   **`Stats`**: Helper class used by `Tracker` and `Timer` to compute the
    statistics for their `stats` method, but also generally useful for computing
    basic statistical information about the elements of an array.

## License

trakr is distributed under the terms of the MIT License.

[1]: https://en.wikipedia.org/wiki/Reservoir_sampling

