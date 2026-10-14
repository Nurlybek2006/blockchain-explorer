import Link from 'next/link';
import { EmptyState } from '@/components/ui';
export default function NotFound() { return <EmptyState title="Page not found" description="This page does not exist. Return to the explorer to continue." action={<Link href="/" className="button button-primary">Back to explorer ↗</Link>} />; }
