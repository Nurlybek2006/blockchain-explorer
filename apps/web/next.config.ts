import type { NextConfig } from "next";
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function connectionOrigin(raw: string, protocols: string[]): string {
  const url = new URL(raw);
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error('Public API/WebSocket URL must use an allowed protocol without credentials');
  }
  return url.origin;
}

export function frontendSecurityHeaders(environment: Readonly<Record<string, string | undefined>>) {
  const development = environment.NODE_ENV === 'development';
  const apiOrigin = connectionOrigin(environment.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000', ['http:', 'https:']);
  const websocketOrigin = connectionOrigin(environment.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/realtime', ['ws:', 'wss:']);
  // Static App Router hydration uses inline scripts; nonce CSP would force every page dynamic.
  const policy = [
    "default-src 'self'", `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    `connect-src 'self' ${apiOrigin} ${websocketOrigin}${development ? ' ws://localhost:3003 ws://127.0.0.1:3003' : ''}`,
  ].join('; ');
  const headers = [
    { key: 'Content-Security-Policy', value: policy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ];
  if (environment.NODE_ENV === 'production' && environment.SECURITY_HSTS_ENABLED === 'true') {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
  }
  return headers;
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  distDir: process.env.WEB_BUILD_DIR ?? '.next',
  typescript: { tsconfigPath: process.env.WEB_TSCONFIG_PATH ?? 'tsconfig.json' },
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  async headers() { return [{ source: '/(.*)', headers: frontendSecurityHeaders(process.env) }]; },
};

export default nextConfig;
