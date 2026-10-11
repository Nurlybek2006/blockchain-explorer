import type {
  BlockTag,
  Hex,
} from './types.js';

import {
  isEthereumAddress,
  strip0x,
} from './utils.js';

import {
  EthereumRpcClient,
} from './ethereum-rpc.client.js';

const SELECTORS = {
  name:
    '0x06fdde03',

  symbol:
    '0x95d89b41',

  decimals:
    '0x313ce567',

  totalSupply:
    '0x18160ddd',

  balanceOf:
    '0x70a08231',
} as const;

export class Erc20Client {
  constructor(
    private readonly rpc:
      EthereumRpcClient,
  ) {}

  async name(
    tokenAddress: string,
    block:
      BlockTag = 'latest',
  ): Promise<string | null> {
    const result =
      await this.rpc.call(
        {
          to:
            tokenAddress,

          data:
            SELECTORS.name as Hex,
        },
        block,
      );

    return decodeAbiString(
      result,
    );
  }

  async symbol(
    tokenAddress: string,
    block:
      BlockTag = 'latest',
  ): Promise<string | null> {
    const result =
      await this.rpc.call(
        {
          to:
            tokenAddress,

          data:
            SELECTORS.symbol as Hex,
        },
        block,
      );

    return decodeAbiString(
      result,
    );
  }

  async decimals(
    tokenAddress: string,
    block:
      BlockTag = 'latest',
  ): Promise<number> {
    const result =
      await this.rpc.call(
        {
          to:
            tokenAddress,

          data:
            SELECTORS.decimals as Hex,
        },
        block,
      );

    return Number(
      decodeUint256(
        result,
      ),
    );
  }

  async totalSupply(
    tokenAddress: string,
    block:
      BlockTag = 'latest',
  ): Promise<bigint> {
    const result =
      await this.rpc.call(
        {
          to:
            tokenAddress,

          data:
            SELECTORS
              .totalSupply as Hex,
        },
        block,
      );

    return decodeUint256(
      result,
    );
  }

  async balanceOf(
    tokenAddress: string,
    walletAddress: string,
    block:
      BlockTag = 'latest',
  ): Promise<bigint> {
    if (
      !isEthereumAddress(
        walletAddress,
      )
    ) {
      throw new Error(
        `Invalid Ethereum address: ${walletAddress}`,
      );
    }

    const encodedAddress =
      strip0x(
        walletAddress,
      ).padStart(
        64,
        '0',
      );

    const data =
      `${SELECTORS.balanceOf}${encodedAddress}` as Hex;

    const result =
      await this.rpc.call(
        {
          to:
            tokenAddress,

          data,
        },
        block,
      );

    return decodeUint256(
      result,
    );
  }
}

function decodeUint256(
  value: Hex,
): bigint {
  if (
    value === '0x' ||
    value.length <= 2
  ) {
    return 0n;
  }

  return BigInt(value);
}

function decodeAbiString(
  value: Hex,
): string | null {
  const hex =
    strip0x(value);

  if (
    hex.length === 0
  ) {
    return null;
  }

  /*
   * Кейбір ескі ERC-20 contract
   * name/symbol-ды bytes32 ретінде
   * қайтарады.
   */
  if (
    hex.length === 64
  ) {
    return decodeUtf8Hex(
      hex,
    );
  }

  if (
    hex.length < 128
  ) {
    return null;
  }

  try {
    const offset =
      Number(
        BigInt(
          `0x${hex.slice(
            0,
            64,
          )}`,
        ),
      ) * 2;

    const lengthStart =
      offset;

    const stringLength =
      Number(
        BigInt(
          `0x${hex.slice(
            lengthStart,
            lengthStart +
              64,
          )}`,
        ),
      );

    const stringStart =
      lengthStart + 64;

    const stringEnd =
      stringStart +
      stringLength * 2;

    return decodeUtf8Hex(
      hex.slice(
        stringStart,
        stringEnd,
      ),
    );
  } catch {
    return null;
  }
}

function decodeUtf8Hex(
  hex: string,
): string | null {
  try {
    const cleanHex =
      hex.replace(
        /00+$/g,
        '',
      );

    if (
      cleanHex.length === 0
    ) {
      return null;
    }

    const bytes =
      new Uint8Array(
        cleanHex
          .match(/.{1,2}/g)
          ?.map(
            (byte) =>
              parseInt(
                byte,
                16,
              ),
          ) ?? [],
      );

    const value =
      new TextDecoder()
        .decode(bytes)
        .replace(
          /\0/g,
          '',
        )
        .trim();

    return value || null;
  } catch {
    return null;
  }
}
// ERC-20 contract-тарға eth_call арқылы тікелей name, symbol, decimals, totalSupply, balanceOf шақыруларын жасайды.
// Кейін Token Indexer кезінде дайын болады.