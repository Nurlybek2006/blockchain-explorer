export interface WalletActivityItem {
  id: string;
  transactionHash: string;
  blockNumber: string;
  timestamp: string;
  direction: 'received' | 'sent' | 'self';
  assetType: 'native' | 'erc20';
  tokenAddress: string | null;
  symbol: string | null;
  decimals: number | null;
  amountRaw: string;
  fromAddress: string;
  toAddress: string;
}

export interface WalletActivityResponse {
  address: string;
  items: WalletActivityItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid activity object');
  }

  return value as Record<string, unknown>;
}

function text(value: unknown, pattern?: RegExp): string {
  if (
    typeof value !== 'string' ||
    value.length > 500 ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error('Invalid activity string');
  }

  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error('Invalid activity number');
  }

  return value;
}

export function decodeWalletActivity(
  value: unknown,
): WalletActivityResponse {
  const source = record(value);
  const pagination = record(source.pagination);

  const addressPattern = /^0x[a-f0-9]{40}$/;
  const hashPattern = /^0x[a-f0-9]{64}$/;
  const amountPattern = /^\d{1,78}$/;

  const address = text(source.address, addressPattern);

  if (!Array.isArray(source.items) || source.items.length > 100) {
    throw new Error('Invalid activity items');
  }

  const page = integer(pagination.page, 1, 1_000_000);
  const limit = integer(pagination.limit, 1, 100);
  const total = integer(pagination.total, 0, Number.MAX_SAFE_INTEGER);
  const totalPages = integer(
    pagination.totalPages,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  if (
    source.items.length > limit ||
    totalPages !== Math.ceil(total / limit)
  ) {
    throw new Error('Invalid activity pagination');
  }

  const items = source.items.map((value): WalletActivityItem => {
    const item = record(value);

    const fromAddress = text(item.fromAddress, addressPattern);
    const toAddress = text(item.toAddress, addressPattern);

    const direction =
      fromAddress === address && toAddress === address
        ? 'self'
        : toAddress === address
          ? 'received'
          : fromAddress === address
            ? 'sent'
            : null;

    if (!direction || item.direction !== direction) {
      throw new Error('Invalid activity direction');
    }

    if (item.assetType !== 'native' && item.assetType !== 'erc20') {
      throw new Error('Invalid activity asset');
    }

    const tokenAddress =
      item.tokenAddress === null
        ? null
        : text(item.tokenAddress, addressPattern);

    const decimals =
      item.decimals === null
        ? null
        : integer(item.decimals, 0, 255);

    const symbol = item.symbol === null ? null : text(item.symbol);

    if (
      (item.assetType === 'native' &&
        (tokenAddress !== null || decimals !== 18 || symbol !== 'ETH')) ||
      (item.assetType === 'erc20' && tokenAddress === null)
    ) {
      throw new Error('Invalid activity metadata');
    }

    const timestamp = text(item.timestamp);

    if (!Number.isFinite(Date.parse(timestamp))) {
      throw new Error('Invalid activity timestamp');
    }

    return {
      id: text(item.id),
      transactionHash: text(item.transactionHash, hashPattern),
      blockNumber: text(item.blockNumber, /^\d{1,19}$/),
      timestamp,
      direction,
      assetType: item.assetType,
      tokenAddress,
      symbol,
      decimals,
      amountRaw: text(item.amountRaw, amountPattern),
      fromAddress,
      toAddress,
    };
  });

  return {
    address,
    items,
    pagination: { page, limit, total, totalPages },
  };
}