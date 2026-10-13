import { BadRequestException, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Erc20Client } from '@blockchain-explorer/blockchain-client';
import {
  isEthereumAddress,
  isTokenTransferIndexedEvent,
  normalizeEthereumAddress,
  type AlertCreateInput,
  type AlertEventListResponse,
  type AlertEventResponse,
  type AlertListResponse,
  type AlertResponse,
  type AlertUpdateInput,
  type AssetPriceResponse,
  type TokenTransferIndexedEvent,
} from '@blockchain-explorer/contracts';
import { FinanceDecimal, toMoney } from '../../common/utils/decimal-math.js';
import { formatTokenBalance } from '../../common/utils/format-token-balance.js';
import { PricesService } from '../prices/prices.service.js';
import { isAlertType, transferMatches, transferUsdValue, type AlertSettings } from './alert-evaluation.js';
import { AlertsRepository, type AlertEventRecord, type AlertRecord, type NewAlertEvent } from './alerts.repository.js';
import { isPositiveUsdThreshold } from './dto/alert.dto.js';

type Store = Pick<AlertsRepository,
  'create' | 'list' | 'findOwned' | 'updateOwned' | 'deleteOwned' | 'listEvents' | 'markReadOwned'
  | 'transferRules' | 'insertTransferEvent' | 'evaluatePrice'>;
type PriceStore = Pick<PricesService, 'subscribe' | 'getPrice'>;
type TokenMetadata = Pick<Erc20Client, 'decimals'>;

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | undefined;
  private readonly defaultWhaleThreshold: string;
  private readonly chainId: number;

  constructor(
    @Inject(AlertsRepository) private readonly repository: Store,
    @Inject(PricesService) private readonly prices: PriceStore,
    @Inject(Erc20Client) private readonly erc20: TokenMetadata,
    config: ConfigService,
  ) {
    this.defaultWhaleThreshold = String(config.get<unknown>('WHALE_DEFAULT_THRESHOLD_USD') ?? '100000');
    if (!isPositiveUsdThreshold(this.defaultWhaleThreshold)) throw new Error('WHALE_DEFAULT_THRESHOLD_USD must be a positive decimal');
    this.chainId = Number(config.get<unknown>('ETHEREUM_CHAIN_ID') ?? 11155111);
    if (!Number.isSafeInteger(this.chainId) || this.chainId < 1 || this.chainId > 2_147_483_647) {
      throw new Error('ETHEREUM_CHAIN_ID must be a positive PostgreSQL integer');
    }
  }

  onModuleInit(): void {
    this.unsubscribe = this.prices.subscribe((price) => this.repository.evaluatePrice(price));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async create(userId: string, input: AlertCreateInput): Promise<AlertResponse> {
    const settings = this.validateSettings({
      type: input.type,
      enabled: input.enabled ?? true,
      walletAddress: input.walletAddress ?? null,
      tokenAddress: input.tokenAddress ?? null,
      thresholdUsd: input.thresholdUsd ?? (input.type === 'whale' ? this.defaultWhaleThreshold : null),
    });
    return serializeAlert(await this.repository.create(userId, settings));
  }

  async list(userId: string, page: number, limit: number): Promise<AlertListResponse> {
    const { items, total } = await this.repository.list(userId, page, limit);
    return { items: items.map(serializeAlert), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async detail(userId: string, id: string): Promise<AlertResponse> {
    const row = await this.repository.findOwned(userId, id);
    if (!row) throw new NotFoundException('Alert not found');
    return serializeAlert(row);
  }

  async update(userId: string, id: string, input: AlertUpdateInput): Promise<AlertResponse> {
    if (!Object.values(input).some((value: unknown) => value !== undefined)) {
      throw new BadRequestException('At least one alert field is required');
    }
    const row = await this.repository.updateOwned(userId, id, (current) => {
      if (!isAlertType(current.type)) throw new BadRequestException('Unsupported stored alert type');
      return this.validateSettings({
        type: input.type ?? current.type,
        enabled: input.enabled ?? current.enabled,
        walletAddress: input.walletAddress === undefined ? current.walletAddress : input.walletAddress,
        tokenAddress: input.tokenAddress === undefined ? current.tokenAddress : input.tokenAddress,
        thresholdUsd: input.thresholdUsd === undefined ? current.thresholdUsd : input.thresholdUsd,
      });
    });
    return serializeAlert(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!await this.repository.deleteOwned(userId, id)) throw new NotFoundException('Alert not found');
  }

  async events(userId: string, page: number, limit: number): Promise<AlertEventListResponse> {
    const { items, total } = await this.repository.listEvents(userId, page, limit);
    return { items: items.map(serializeAlertEvent), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async markRead(userId: string, id: string): Promise<AlertEventResponse> {
    const row = await this.repository.markReadOwned(userId, id);
    if (!row) throw new NotFoundException('Alert event not found');
    return serializeAlertEvent(row);
  }

  async evaluateTransfer(event: TokenTransferIndexedEvent): Promise<void> {
    if (!isTokenTransferIndexedEvent(event)) throw new Error('Invalid token transfer alert event');
    if (event.payload.chainId !== this.chainId) return;
    const payload = event.payload;
    const rules = await this.repository.transferRules(payload.tokenAddress.toLowerCase(), payload.fromAddress.toLowerCase(), payload.toAddress.toLowerCase());
    if (rules.length === 0) return;
    // ERC-20 metadata comes from the event or RPC, independent of whether any portfolio holds the token.
    const decimals = payload.tokenDecimals ?? await this.erc20.decimals(payload.tokenAddress, BigInt(payload.blockNumber));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid transfer token decimals');
    const amountFormatted = formatTokenBalance(payload.amountRaw, decimals);
    const eventKey = `transfer:${payload.chainId}:${payload.transactionHash.toLowerCase()}:${payload.logIndex}`;

    // Wallet activity must still commit when whale valuation needs to retry because pricing is unavailable.
    for (const rule of rules) {
      if (rule.type !== 'wallet_activity') continue;
      await this.repository.insertTransferEvent(rule.id, eventKey, (current) => {
        if (!isAlertType(current.type) || current.type !== 'wallet_activity' || !transferMatches({ ...current, type: current.type }, event)) return null;
        return this.transferEvent(current, event, decimals, amountFormatted, null);
      });
    }

    if (!rules.some((rule) => rule.type === 'whale')) return;
    const price = await this.prices.getPrice(`erc20:${payload.tokenAddress.toLowerCase()}`);
    if (price.availability !== 'available' || price.stale || price.priceUsd === null || price.fetchedAt === null) {
      throw new Error('Fresh token price unavailable for whale alert evaluation');
    }
    const valueUsd = transferUsdValue(payload.amountRaw, decimals, price.priceUsd);
    for (const rule of rules) {
      if (rule.type !== 'whale') continue;
      await this.repository.insertTransferEvent(rule.id, eventKey, (current) => {
        if (!isAlertType(current.type) || current.type !== 'whale' || !transferMatches({ ...current, type: current.type }, event)
          || current.thresholdUsd === null || valueUsd.lt(new FinanceDecimal(current.thresholdUsd))) return null;
        return this.transferEvent(current, event, decimals, amountFormatted, price);
      });
    }
  }

  private transferEvent(
    rule: AlertRecord,
    event: TokenTransferIndexedEvent,
    decimals: number,
    amountFormatted: string,
    price: AssetPriceResponse | null,
  ): NewAlertEvent {
    const transfer = event.payload;
    const symbol = transfer.tokenSymbol ?? price?.symbol ?? null;
    const valueUsd = price?.priceUsd === null || price?.priceUsd === undefined
      ? null : toMoney(transferUsdValue(transfer.amountRaw, decimals, price.priceUsd));
    return {
      title: rule.type === 'whale' ? 'Whale token transfer' : 'Wallet token activity',
      message: `${amountFormatted} ${symbol ?? 'tokens'} transferred${valueUsd === null ? '' : ` (approximately ${valueUsd} USD at current price)`}`,
      payload: {
        sourceEventId: event.id, chainId: transfer.chainId, transactionHash: transfer.transactionHash,
        logIndex: transfer.logIndex, blockNumber: transfer.blockNumber,
        tokenAddress: transfer.tokenAddress.toLowerCase(), symbol, decimals,
        fromAddress: transfer.fromAddress.toLowerCase(), toAddress: transfer.toAddress.toLowerCase(),
        amountRaw: transfer.amountRaw, amountFormatted, valueUsd,
        priceUsd: price?.priceUsd ?? null, priceFetchedAt: price?.fetchedAt ?? null,
        valuationBasis: price === null ? null : 'current_price',
      },
    };
  }

  private validateSettings(settings: AlertSettings): AlertSettings {
    if (!isAlertType(settings.type)) throw new BadRequestException('Invalid alert type');
    for (const address of [settings.walletAddress, settings.tokenAddress]) {
      if (address !== null && !isEthereumAddress(address)) throw new BadRequestException('Invalid alert Ethereum address');
    }
    if (settings.thresholdUsd !== null && !isPositiveUsdThreshold(settings.thresholdUsd)) {
      throw new BadRequestException('thresholdUsd must be a positive decimal string');
    }
    if (settings.type === 'wallet_activity') {
      if (settings.walletAddress === null) throw new BadRequestException('wallet_activity requires walletAddress');
      if (settings.thresholdUsd !== null) throw new BadRequestException('wallet_activity does not accept thresholdUsd');
    } else if (settings.thresholdUsd === null) {
      throw new BadRequestException('This alert type requires thresholdUsd');
    }
    if ((settings.type === 'price_above' || settings.type === 'price_below') && settings.walletAddress !== null) {
      throw new BadRequestException('Price alerts do not accept walletAddress');
    }
    return {
      ...settings,
      walletAddress: settings.walletAddress === null ? null : normalizeEthereumAddress(settings.walletAddress),
      tokenAddress: settings.tokenAddress === null ? null : normalizeEthereumAddress(settings.tokenAddress),
      thresholdUsd: settings.thresholdUsd === null ? null : toMoney(settings.thresholdUsd),
    };
  }
}

export function serializeAlert(row: AlertRecord): AlertResponse {
  if (!isAlertType(row.type)) throw new Error('Invalid stored alert type');
  return {
    id: row.id, type: row.type, enabled: row.enabled,
    walletAddress: row.walletAddress, tokenAddress: row.tokenAddress,
    thresholdUsd: row.thresholdUsd === null ? null : toMoney(row.thresholdUsd),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeAlertEvent(row: AlertEventRecord): AlertEventResponse {
  return {
    id: row.id, alertId: row.alertId, title: row.title, message: row.message, payload: row.payload,
    triggeredAt: row.triggeredAt.toISOString(), readAt: row.readAt?.toISOString() ?? null,
  };
}
