/** Public live Explorer messages. No identity, credential or private alert data. */
export interface RealtimeBlockPayload {
  chainId: number;
  networkName: string;
  blockNumber: string;
  blockHash: string;
  parentHash: string;
  timestamp: string;
  transactionCount: number;
  logCount: number;
  tokenTransferCount: number;
}

export interface RealtimeTransferPayload {
  chainId: number;
  networkName: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
}

export interface RealtimeReorgPayload {
  chainId: number;
  networkName: string;
  detectedAtBlock: string;
  commonAncestorBlock: string;
  commonAncestorHash: string | null;
}

export interface RealtimeMessage<TType extends string, TPayload> {
  id: string;
  type: TType;
  occurredAt: string;
  payload: TPayload;
}

export type RealtimeExplorerEvent =
  | RealtimeMessage<'block.indexed', RealtimeBlockPayload>
  | RealtimeMessage<'token.transfer.indexed', RealtimeTransferPayload>
  | RealtimeMessage<'chain.reorganized', RealtimeReorgPayload>;
