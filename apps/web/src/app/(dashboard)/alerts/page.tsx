import type { Metadata } from 'next';
import { Alerts } from '@/features/alerts/alerts';

export const metadata: Metadata = { title: 'Alerts' };
function pageValue(value: string | string[] | undefined): number { return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), 10000) : 1; }
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; eventsPage?: string | string[] }> }) {
  const query = await searchParams;
  const page = pageValue(query.page), eventPage = pageValue(query.eventsPage);
  return <Alerts key={`${page}-${eventPage}`} page={page} eventPage={eventPage} />;
}
