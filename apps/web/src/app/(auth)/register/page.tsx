import type { Metadata } from 'next';
import { getServerTranslation } from '@/i18n/server';
import { AuthForm } from '@/features/auth/auth-form';
export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('auth.create') }; }
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams; return <AuthForm mode="register" returnTo={query.next} />;
}
