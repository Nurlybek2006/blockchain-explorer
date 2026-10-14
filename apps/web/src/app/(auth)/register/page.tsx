import type { Metadata } from 'next';
import { AuthForm } from '@/features/auth/auth-form';
export const metadata: Metadata = { title: 'Create account' };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams; return <AuthForm mode="register" returnTo={query.next} />;
}
