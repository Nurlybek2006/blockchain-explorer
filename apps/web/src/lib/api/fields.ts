export class ContractError extends Error {
  constructor(field = 'response') { super(`Invalid API ${field}`); this.name = 'ContractError'; }
}
export function invalidResponse(field?: string): never { throw new ContractError(field); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function readRecord(value: unknown, field?: string): Record<string, unknown> {
  if (!isRecord(value)) return invalidResponse(field); return value;
}
export function readString(value: unknown, field?: string): string {
  if (typeof value !== 'string') return invalidResponse(field); return value;
}
export function readNullableString(value: unknown, field?: string): string | null {
  return value === null ? null : readString(value, field);
}
export function readBoolean(value: unknown, field?: string): boolean {
  if (typeof value !== 'boolean') return invalidResponse(field); return value;
}
export function readInteger(value: unknown, field?: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalidResponse(field); return value;
}
export function readTimestamp(value: unknown, field?: string): string {
  const text = readString(value, field); if (!Number.isFinite(Date.parse(text))) return invalidResponse(field); return text;
}
export function readNullableTimestamp(value: unknown, field?: string): string | null {
  return value === null ? null : readTimestamp(value, field);
}
export function readArray<T>(value: unknown, decode: (item: unknown) => T, field?: string): T[] {
  if (!Array.isArray(value)) return invalidResponse(field); return value.map(decode);
}
export { readRecord as decodeRecord, readString as decodeString, readNullableString as decodeNullableString,
  readBoolean as decodeBoolean, readInteger as decodeInteger, readArray as decodeArray };
