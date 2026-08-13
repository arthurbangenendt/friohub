import { performance } from "node:perf_hooks";

const url = process.env.FRIOHUB_LOAD_URL || "http://127.0.0.1:3000/api/health";
const durationMs = Number(process.env.FRIOHUB_LOAD_DURATION_MS || 10_000);
const concurrency = Number(process.env.FRIOHUB_LOAD_CONCURRENCY || 10);
const maxP95Ms = Number(process.env.FRIOHUB_LOAD_MAX_P95_MS || 500);
const maxErrorRate = Number(process.env.FRIOHUB_LOAD_MAX_ERROR_RATE || 0.01);
if (![durationMs, concurrency, maxP95Ms, maxErrorRate].every(Number.isFinite) || durationMs < 1000 || concurrency < 1) {
  throw new Error("Configuração inválida do teste de carga.");
}

const deadline = performance.now() + durationMs;
const latencies = [];
let errors = 0;

async function worker() {
  while (performance.now() < deadline) {
    const start = performance.now();
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status >= 500) errors += 1;
      await response.arrayBuffer();
    } catch {
      errors += 1;
    } finally {
      latencies.push(performance.now() - start);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? Infinity;
const errorRate = latencies.length ? errors / latencies.length : 1;
console.log(JSON.stringify({ url, requests: latencies.length, errors, errorRate, p95Ms: Math.round(p95 * 10) / 10 }));
if (p95 > maxP95Ms || errorRate > maxErrorRate) process.exitCode = 1;
