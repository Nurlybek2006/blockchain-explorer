import type { ReactNode } from 'react';
import { AuthGate } from '@/features/auth/auth-gate';
export default function DashboardLayout({ children }: { children: ReactNode }) { return <AuthGate>{children}</AuthGate>; }
