// Per-input cost samples, exposed at window.__BURROW_PERF for the budget gate.
export function createPerf(size = 512) {
  const samples = { input: [], render: [] };
  const counters = { queries: 0, pulls: 0, builds: 0 };
  const push = (name, ms) => {
    const list = samples[name] || (samples[name] = []);
    list.push(ms);
    if (list.length > size) list.shift();
  };
  const pct = (name, p) => {
    const list = [...(samples[name] || [])].sort((a, b) => a - b);
    if (!list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(p * list.length))];
  };
  return {
    samples,
    counters,
    push,
    time(name, fn) {
      const t0 = performance.now();
      try { return fn(); } finally { push(name, performance.now() - t0); }
    },
    summary(name = "input") {
      return { n: samples[name]?.length || 0, p50: pct(name, 0.5), p95: pct(name, 0.95), max: pct(name, 1) };
    },
    reset() {
      for (const key of Object.keys(samples)) samples[key] = [];
      for (const key of Object.keys(counters)) counters[key] = 0;
    },
  };
}
