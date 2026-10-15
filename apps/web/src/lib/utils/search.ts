export type ExplorerSearchInvalidCode = 'too-long' | 'invalid-format';

export type ExplorerSearchResult =
  | { kind: 'block'; value: string; href: string }
  | { kind: 'transaction'; value: string; href: string }
  | { kind: 'address'; value: string; href: string }
  | { kind: 'invalid'; code: ExplorerSearchInvalidCode };

export function parseExplorerSearch(input: string): ExplorerSearchResult {
  const query = input.trim();
  if (query.length > 256) return { kind: 'invalid', code: 'too-long' };
  if (/^\d+$/.test(query)) {
    const number = BigInt(query).toString();
    return { kind: 'block', value: number, href: `/blocks/${number}` };
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(query)) {
    const hash = query.toLowerCase();
    return { kind: 'transaction', value: hash, href: `/tx/${hash}` };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(query)) {
    const address = query.toLowerCase();
    return { kind: 'address', value: address, href: `/address/${address}` };
  }
  return { kind: 'invalid', code: 'invalid-format' };
}

export function parseExplorerPagination(query: Record<string, string | string[] | undefined>) {
  const parse = (value: string | string[] | undefined, fallback: number, maximum: number) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
    const result = Number(value);
    return Number.isSafeInteger(result) && result >= 1 && result <= maximum ? result : fallback;
  };
  return { page: parse(query.page, 1, 1_000_000), limit: parse(query.limit, 20, 100) };
}
