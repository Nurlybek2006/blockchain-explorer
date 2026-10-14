'use client';
import { ErrorState } from '@/components/ui';
export default function ErrorBoundary({ retry }: { error: Error & { digest?: string }; retry: () => void }) { return <ErrorState error={null} retry={retry} />; }
