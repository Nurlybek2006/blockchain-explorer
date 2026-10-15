import type { Metadata } from 'next';
import { getServerTranslation } from '@/i18n/server';
import { Profile } from '@/features/auth/profile';
export async function generateMetadata(): Promise<Metadata> { const { t } = await getServerTranslation(); return { title: t('settings.title') }; }
export default function SettingsPage() { return <Profile />; }
