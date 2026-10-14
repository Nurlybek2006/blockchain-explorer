export function calculateNetworkLag(rpcLatest: string | null, indexed: string | null): string | null {
  if (rpcLatest === null || indexed === null || !/^\d+$/.test(rpcLatest) || !/^\d+$/.test(indexed)) return null;
  const lag = BigInt(rpcLatest) - BigInt(indexed);
  return lag < 0n ? null : lag.toString();
}
