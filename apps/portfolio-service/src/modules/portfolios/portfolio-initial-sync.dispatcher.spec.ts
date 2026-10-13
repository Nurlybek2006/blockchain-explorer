import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema/index.js';
import type { PortfolioJobsService } from '../jobs/portfolio-jobs.service.js';
import { PortfolioInitialSyncDispatcher } from './portfolio-initial-sync.dispatcher.js';

describe('PortfolioInitialSyncDispatcher lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function setup() {
    const database = { db: drizzle.mock({ schema }) };
    const jobs: Pick<PortfolioJobsService, 'enqueueInitialSync'> = {
      enqueueInitialSync: vi.fn<PortfolioJobsService['enqueueInitialSync']>().mockResolvedValue(),
    };
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const dispatcher = new PortfolioInitialSyncDispatcher(database, jobs);
    return { database, jobs, dispatcher };
  }

  it('keeps database failures internal and permits a later dispatch attempt', async () => {
    const { database, jobs, dispatcher } = setup();
    const transaction = vi.spyOn(database.db, 'transaction')
      .mockRejectedValue(new Error('Database temporarily unavailable'));

    await expect(dispatcher.flush()).resolves.toBeUndefined();
    await expect(dispatcher.flush()).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(jobs.enqueueInitialSync).not.toHaveBeenCalled();
  });

  it('shares one active drain across concurrent create and timer calls', async () => {
    const { database, dispatcher } = setup();
    let rejectTransaction: ((reason: Error) => void) | undefined;
    const transaction = vi.spyOn(database.db, 'transaction')
      .mockImplementation(() => new Promise<never>((_resolve, reject) => { rejectTransaction = reject; }));

    const first = dispatcher.flush();
    const second = dispatcher.flush();
    expect(second).toBe(first);
    expect(transaction).toHaveBeenCalledOnce();
    rejectTransaction?.(new Error('Database unavailable'));
    await first;
  });

  it('waits for an active drain on shutdown and prevents subsequent dispatch', async () => {
    const { database, dispatcher } = setup();
    let rejectTransaction: ((reason: Error) => void) | undefined;
    const transaction = vi.spyOn(database.db, 'transaction')
      .mockImplementation(() => new Promise<never>((_resolve, reject) => { rejectTransaction = reject; }));

    const running = dispatcher.flush();
    const shutdown = dispatcher.onModuleDestroy();
    rejectTransaction?.(new Error('Database unavailable'));
    await Promise.all([running, shutdown]);
    await dispatcher.flush();
    expect(transaction).toHaveBeenCalledOnce();
  });
});
