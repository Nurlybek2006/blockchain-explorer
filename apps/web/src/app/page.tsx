import type { Metadata } from 'next';
import { ExplorerOverview } from '@/features/explorer/overview';

export const metadata: Metadata = { title: 'Explorer Overview', description: 'Explore indexed Sepolia blocks, transactions, addresses, and ERC-20 tokens.' };

export default function Home() { return <ExplorerOverview />; }
