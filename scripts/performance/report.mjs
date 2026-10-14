import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function boundedInteger(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}

export function distribution(values) {
  if (!values.length) return { min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
  return { min: sorted[0], max: sorted.at(-1), p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) };
}

export async function saveReport(name, report) {
  const directory = resolve('artifacts/performance');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${name}.json`);
  await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n');
  console.log(`Report: ${file}`);
  return file;
}
