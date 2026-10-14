import type { ExplorerSearchResponse } from '@blockchain-explorer/contracts';

export class SearchInputError extends Error {}
export interface IndexedSearchLookup {
  blockNumber(value: string): Promise<string | null>;
  transaction(hash: string): Promise<boolean>;
  blockHash(hash: string): Promise<string | null>;
  addressKind(address: string): Promise<'token' | 'contract' | 'address' | null>;
}
export async function resolveIndexedSearch(input: unknown, lookup: IndexedSearchLookup): Promise<ExplorerSearchResponse | null> {
  if (typeof input !== 'string' || !input.trim() || input.length > 128) throw new SearchInputError('Enter a block number, hash or Ethereum address');
  const query = input.trim().toLowerCase();
  if (/^\d+$/.test(query)) {
    const number = BigInt(query);
    if (number > 9223372036854775807n) throw new SearchInputError('Block number is out of range');
    const block = await lookup.blockNumber(number.toString());
    return block === null ? null : { type: 'block', value: block, destination: `/blocks/${block}` };
  }
  if (/^0x[0-9a-f]{64}$/.test(query)) {
    if (await lookup.transaction(query)) return { type: 'transaction', value: query, destination: `/tx/${query}` };
    const block = await lookup.blockHash(query);
    return block === null ? null : { type: 'block', value: block, destination: `/blocks/${block}` };
  }
  if (/^0x[0-9a-f]{40}$/.test(query)) {
    const type = await lookup.addressKind(query);
    return type === null ? null : { type, value: query, destination: `/${type}/${query}` };
  }
  throw new SearchInputError('Enter a block number, hash or Ethereum address');
}
