import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
export const affectsExplorerOverview = (event: RealtimeExplorerEvent): boolean => event.type === 'block.indexed' || event.type === 'chain.reorganized';
export const affectsReorganizedData = (event: RealtimeExplorerEvent): boolean => event.type === 'chain.reorganized';
export function affectsAddress(event: RealtimeExplorerEvent, address: string): boolean { return event.type === 'chain.reorganized' || (event.type === 'token.transfer.indexed' && [event.payload.fromAddress, event.payload.toAddress].some(value => value.toLowerCase() === address.toLowerCase())); }
export function affectsToken(event: RealtimeExplorerEvent, address: string): boolean { return event.type === 'chain.reorganized' || (event.type === 'token.transfer.indexed' && event.payload.tokenAddress.toLowerCase() === address.toLowerCase()); }
