import type { Metadata } from 'next';
import { Profile } from '@/features/auth/profile';
export const metadata: Metadata = { title: 'Your profile' };
export default function SettingsPage() { return <Profile />; }
