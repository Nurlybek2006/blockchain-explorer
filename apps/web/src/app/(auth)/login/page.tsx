import type { Metadata } from 'next';
import { AuthForm } from '@/features/auth/auth-form';
export const metadata: Metadata = { title: 'Sign in' };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams; return <AuthForm mode="login" returnTo={query.next} />;
}
