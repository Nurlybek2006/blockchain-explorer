export interface ArchiveEntry { database: string; archive: string; bytes: number; sha256: string }
export interface ArchiveManifest { version: 1; createdAt: string; containerId: string; databases: ArchiveEntry[] }
export interface ArchiveOptions { container: string; user: string; password?: string; directory: string }
export function backupDatabases(input: ArchiveOptions & { databases?: string[] }): Promise<{ directory: string; manifest: ArchiveManifest }>;
export function restoreDatabase(input: ArchiveOptions & { database: string; target: string; confirmation: string }): Promise<{ database: string; target: string }>;
export function parseArguments(argv: string[], allowed: string[]): Record<string, string>;
