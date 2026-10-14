import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ContractDetailResponse,
  TransactionTraceEntry,
  TransactionTraceResponse,
} from '@blockchain-explorer/contracts';
import { AdvancedExplorerRepository } from './advanced-explorer.repository.js';
import { loadAdvancedConfig, type AdvancedConfig } from './advanced.config.js';
import { isValueBearingInternalCall } from './trace-normalizer.js';

export function sortTracePaths(left: string, right: string): number {
  if (left === 'root') return right === 'root' ? 0 : -1;
  if (right === 'root') return 1;
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1)
    if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

@Injectable()
export class AdvancedExplorerService {
  private readonly options: AdvancedConfig;
  constructor(
    private readonly repository: AdvancedExplorerRepository,
    config: ConfigService,
  ) {
    this.options = loadAdvancedConfig(config);
  }

  async getContract(address: string): Promise<ContractDetailResponse | null> {
    const registry = await this.repository.getAddress(address.toLowerCase());
    if (!registry?.isContract) return null;
    let verification = await this.repository.getVerification(registry.address);
    if (!verification) {
      await this.repository.ensureVerificationIntent(
        registry.address,
        this.options,
      );
      verification = await this.repository.getVerification(registry.address);
    }
    const storedStatus =
      verification?.status ??
      (this.options.verificationEnabled ? 'pending' : 'unsupported');
    const status =
      storedStatus === 'verified' &&
      (!verification?.sourceCode?.trim() || !Array.isArray(verification.abi))
        ? 'unverified'
        : storedStatus;
    return {
      address: registry.address,
      isContract: true,
      firstSeenBlock: registry.firstSeenBlock?.toString() ?? null,
      lastSeenBlock: registry.lastSeenBlock?.toString() ?? null,
      verification: {
        status,
        verified:
          status === 'verified' &&
          Boolean(verification?.sourceCode?.trim()) &&
          Array.isArray(verification?.abi),
        contractName: verification?.contractName ?? null,
        compilerVersion: verification?.compilerVersion ?? null,
        optimizationUsed: verification?.optimizationUsed ?? null,
        optimizationRuns: verification?.optimizationRuns ?? null,
        sourceCode: verification?.sourceCode ?? null,
        abi: Array.isArray(verification?.abi) ? verification.abi : null,
        constructorArguments: verification?.constructorArguments ?? null,
        verificationSource: verification?.verificationSource ?? 'etherscan-v2',
        verifiedAt:
          status === 'verified'
            ? (verification?.verifiedAt?.toISOString() ?? null)
            : null,
        lastCheckedAt: verification?.lastCheckedAt?.toISOString() ?? null,
      },
    };
  }

  async getTraces(hash: string): Promise<TransactionTraceResponse> {
    const transactionHash = hash.toLowerCase();
    const transaction = await this.repository.getTransaction(transactionHash);
    const response: TransactionTraceResponse = {
      transactionHash,
      available: false,
      status: 'not_requested',
      reason: 'not-indexed',
      traces: [],
      internalCalls: [],
      updatedAt: null,
    };
    if (!transaction) return response;
    let request = await this.repository.getTraceRequest(transactionHash);
    if (!request) {
      await this.repository.requestTrace(transactionHash, this.options);
      request = await this.repository.getTraceRequest(transactionHash);
    }
    if (!request)
      return {
        ...response,
        reason: this.options.traceEnabled ? 'not-requested' : 'not-supported',
        status: this.options.traceEnabled ? 'not_requested' : 'unsupported',
      };
    response.status = request.status;
    response.updatedAt = request.updatedAt.toISOString();
    if (request.status !== 'completed') {
      response.reason =
        request.status === 'unsupported'
          ? 'not-supported'
          : request.status === 'failed'
            ? 'failed'
            : request.status === 'not_requested'
              ? 'not-requested'
              : 'pending';
      return response;
    }
    const rows = await this.repository.getTraces(transactionHash);
    rows.sort((a, b) => sortTracePaths(a.traceAddress, b.traceAddress));
    const failedPaths = new Set(
      rows.filter((row) => row.error !== null).map((row) => row.traceAddress),
    );
    const traces: TransactionTraceEntry[] = rows.map((row) => {
      const path =
        row.traceAddress === 'root' ? [] : row.traceAddress.split('.');
      const ancestorFailed =
        failedPaths.has('root') ||
        path.some((_, index) =>
          failedPaths.has(path.slice(0, index).join('.')),
        );
      return {
        transactionHash: row.transactionHash,
        blockNumber: row.blockNumber.toString(),
        traceAddress: row.traceAddress,
        depth: path.length,
        type: row.type,
        callType: row.callType,
        fromAddress: row.fromAddress,
        toAddress: row.toAddress,
        value: row.value,
        gas: row.gas,
        gasUsed: row.gasUsed,
        input: row.input,
        output: row.output,
        error: row.error,
        valueBearing: !ancestorFailed && isValueBearingInternalCall(row),
      };
    });
    return {
      ...response,
      available: true,
      reason: null,
      traces,
      internalCalls: traces.filter((row) => row.valueBearing),
    };
  }
}
