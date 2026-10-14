import type { TestProject } from 'vitest/node';
import { startTestEnvironment, type TestEnvironment } from './test-environment.js';

declare module 'vitest' { export interface ProvidedContext { environment: TestEnvironment; } }

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { environment, stop } = await startTestEnvironment();
  project.provide('environment', environment);
  return stop;
}
