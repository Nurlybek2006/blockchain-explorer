import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({
  path: '../../.env',
});

if (!process.env.PORTFOLIO_DATABASE_URL) {
  throw new Error('PORTFOLIO_DATABASE_URL is not defined');
}

export default defineConfig({
  dialect: 'postgresql',

  schema: './src/database/schema/*.ts',

  out: './src/database/migrations',

  dbCredentials: {
    url: process.env.PORTFOLIO_DATABASE_URL,
  },

  verbose: true,
  strict: true,
});