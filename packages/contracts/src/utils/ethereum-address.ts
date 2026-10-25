export function isEthereumAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeEthereumAddress(value: string): string {
  const address = value.trim();
  if (!isEthereumAddress(address)) {
    throw new Error('Invalid Ethereum wallet address');
  }
  return address.toLowerCase();
}