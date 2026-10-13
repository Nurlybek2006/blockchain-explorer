import { normalizeEthereumAddress } from './ethereum-address.js';

export function isAssetKey(value: unknown): value is string {
  return value === 'native:eth' || (typeof value === 'string' && /^erc20:0x[0-9a-f]{40}$/.test(value));
}

export function normalizeAssetKey(value: string): string {
  const key = value.trim();
  if (key === 'native:eth') return key;
  if (key.startsWith('erc20:')) return `erc20:${normalizeEthereumAddress(key.slice(6))}`;
  throw new Error('Invalid asset key');
}
