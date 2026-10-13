import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
} from '@blockchain-explorer/contracts';
import { PortfolioClient } from './portfolio.client.js';

const ownerId = '1f261778-cb85-49e4-8775-d216e6a271c1';
const portfolio: PortfolioResponse = {
  id: '3d4b61ab-14fa-4e11-8f1e-11d5ba45f7a4',
  name: 'Main Portfolio',
  walletAddress: '0x1234567890123456789012345678901234567890',
  chainId: 11155111,
  isPrimary: true,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
};
const holding: PortfolioHoldingResponse = {
  assetKey: 'native:eth',
  assetType: 'native',
  tokenAddress: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  balanceRaw: '123456789012345678901234567890',
  balanceFormatted: '123456789012.34567890123456789',
  lastUpdatedBlock: '19000000',
  updatedAt: '2026-10-13T00:00:00.000Z',
};

function makeClient(timeoutMs = 10_000): PortfolioClient {
  return new PortfolioClient(new ConfigService({
    PORTFOLIO_INTERNAL_URL: 'http://portfolio:3002/',
    INTERNAL_SERVICE_TOKEN: 'private-test-token',
    PORTFOLIO_HTTP_TIMEOUT_MS: timeoutMs,
  }));
}

describe('PortfolioClient internal HTTP contract', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the authenticated owner and sends only create contract fields', async () => {
    fetchMock.mockResolvedValue(Response.json({ ...portfolio, userId: ownerId, passwordHash: 'private' }));
    const input = {
      name: portfolio.name,
      walletAddress: portfolio.walletAddress,
      chainId: portfolio.chainId,
      userId: 'spoofed-user',
      passwordHash: 'spoofed-secret',
    };

    const result = await makeClient().create(ownerId, input);
    expect(result).toEqual(portfolio);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Expected portfolio HTTP request');
    expect(String(call[0])).toBe('http://portfolio:3002/internal/portfolios');
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: {
        'x-internal-service-token': 'private-test-token',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      redirect: 'error',
    });
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      userId: ownerId,
      name: portfolio.name,
      walletAddress: portfolio.walletAddress,
      chainId: portfolio.chainId,
    });
  });

  it('scopes every read, rename and delete to the authenticated owner', async () => {
    const client = makeClient();
    fetchMock
      .mockResolvedValueOnce(Response.json({ items: [portfolio], page: 2, limit: 20, total: 21, totalPages: 2 }))
      .mockResolvedValueOnce(Response.json({ ...portfolio, holdings: [holding] }))
      .mockResolvedValueOnce(Response.json(portfolio))
      .mockResolvedValueOnce(Response.json([holding]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.list(ownerId, 2, 20);
    await client.detail(ownerId, portfolio.id);
    const rename = { name: 'Renamed', userId: 'spoofed-user', walletAddress: 'spoofed-wallet' };
    await client.update(ownerId, portfolio.id, rename);
    expect(await client.holdings(ownerId, portfolio.id)).toEqual([holding]);
    await client.remove(ownerId, portfolio.id);

    expect(fetchMock.mock.calls).toHaveLength(5);
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get('userId')).toBe(ownerId);
    }
    const listCall = fetchMock.mock.calls[0];
    const renameCall = fetchMock.mock.calls[2];
    if (!listCall || !renameCall) throw new Error('Expected scoped HTTP requests');
    expect(new URL(String(listCall[0])).searchParams.get('page')).toBe('2');
    expect(new URL(String(listCall[0])).searchParams.get('limit')).toBe('20');
    expect(JSON.parse(String(renameCall[1]?.body))).toEqual({ name: 'Renamed' });
  });

  it.each([
    [400, 'Invalid portfolio request'],
    [404, 'Portfolio not found'],
    [409, 'A portfolio already exists for this wallet and chain'],
    [503, 'Portfolio service unavailable'],
  ])('maps upstream %i to a safe public error', async (status, message) => {
    fetchMock.mockResolvedValue(Response.json({
      message: 'postgres://username:password@internal-host/private-db',
      details: 'private-test-token',
    }, { status }));
    await expect(makeClient().detail(ownerId, portfolio.id)).rejects.toMatchObject({
      status,
      message,
    });
  });

  it.each([401, 403, 500, 502])('maps unexpected upstream %i to 502 without leaking its body', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: 'secret infrastructure details' }, { status }));
    await expect(makeClient().detail(ownerId, portfolio.id)).rejects.toMatchObject({
      status: 502,
      message: 'Portfolio service request failed',
    });
  });

  it('maps network errors to 503 without leaking the connection error', async () => {
    fetchMock.mockRejectedValue(new Error('private connection string'));
    await expect(makeClient().list(ownerId, 1, 20)).rejects.toMatchObject({
      status: 503,
      message: 'Portfolio service unavailable',
    });
  });

  it('aborts timed out requests and returns 503', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const assertion = expect(makeClient(25).list(ownerId, 1, 20)).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { ...portfolio, chainId: '11155111' },
    { ...portfolio, walletAddress: 'invalid' },
    { ...portfolio, id: 'not-a-uuid' },
    { ...portfolio, createdAt: 'not-a-date' },
  ])('rejects invalid success response contract fields', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(makeClient().create(ownerId, {
      name: portfolio.name,
      walletAddress: portfolio.walletAddress,
    })).rejects.toMatchObject({ status: 502 });
  });

  it('rejects numeric raw balances instead of losing blockchain precision', async () => {
    fetchMock.mockResolvedValue(Response.json([{ ...holding, balanceRaw: 9007199254740992 }]));
    await expect(makeClient().holdings(ownerId, portfolio.id)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects invalid JSON and unexpected delete responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>upstream error</html>'));
    await expect(makeClient().detail(ownerId, portfolio.id)).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(Response.json({ deleted: true }));
    await expect(makeClient().remove(ownerId, portfolio.id)).rejects.toMatchObject({ status: 502 });
  });
});
