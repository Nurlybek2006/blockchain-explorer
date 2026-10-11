import type {
  BlockTag,
  Hex,
} from './types.js';

export function strip0x(
  value: string,
): string {
  return value.startsWith('0x')
    ? value.slice(2)
    : value;
}

export function add0x(
  value: string,
): Hex {
  return (
    value.startsWith('0x')
      ? value
      : `0x${value}`
  ) as Hex;
}

export function toHexQuantity(
  value: bigint | number,
): Hex {
  const bigintValue =
    typeof value === 'bigint'
      ? value
      : BigInt(value);

  if (bigintValue < 0n) {
    throw new Error(
      'Ethereum quantity cannot be negative',
    );
  }

  return `0x${bigintValue.toString(16)}`;
}

export function blockTagToRpc(
  block: BlockTag,
): string {
  if (typeof block === 'bigint') {
    return toHexQuantity(block);
  }

  if (typeof block === 'number') {
    return toHexQuantity(block);
  }

  return block;
}

export function hexToBigInt(
  value:
    | Hex
    | string
    | null
    | undefined,
  fallback = 0n,
): bigint {
  if (
    value === null ||
    value === undefined ||
    value === '0x'
  ) {
    return fallback;
  }

  return BigInt(value);
}

export function hexToNumber(
  value:
    | Hex
    | string
    | null
    | undefined,
  fallback = 0,
): number {
  const number =
    hexToBigInt(
      value,
      BigInt(fallback),
    );

  if (
    number >
    BigInt(
      Number.MAX_SAFE_INTEGER,
    )
  ) {
    throw new Error(
      `Value ${value} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }

  return Number(number);
}

export function normalizeAddress(
  address:
    | string
    | null
    | undefined,
): string | null {
  if (!address) {
    return null;
  }

  return address.toLowerCase();
}

export function normalizeHash(
  hash:
    | string
    | null
    | undefined,
): string | null {
  if (!hash) {
    return null;
  }

  return hash.toLowerCase();
}

export function isEthereumAddress(
  value: string,
): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(
    value,
  );
}

export function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

export function chunkArray<T>(
  values: readonly T[],
  size: number,
): T[][] {
  if (size <= 0) {
    throw new Error(
      'Chunk size must be greater than 0',
    );
  }

  const result: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    result.push(
      values.slice(
        index,
        index + size,
      ),
    );
  }

  return result;
}
// Ethereum hex санын bigint-ке айналдыру, address нормализациялау, block tag жасау сияқты ортақ функцияларды береді.