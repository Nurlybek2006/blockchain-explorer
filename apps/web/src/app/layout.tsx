import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/providers/auth-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { RealtimeProvider } from "@/providers/realtime-provider";
import { LocaleProvider } from "@/providers/locale-provider";
import { AppShell } from "@/components/layout/app-shell";
import { getServerTranslation } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: { default: t('common.metadata.title'), template: '%s | Blockchain Explorer' },
    description: t('common.metadata.description'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getServerTranslation();
  return (
    <html lang={locale}>
      {/* Browser extensions can add body attributes before React hydrates. */}
      <body suppressHydrationWarning><LocaleProvider initialLocale={locale}><AuthProvider><ToastProvider><RealtimeProvider><AppShell>{children}</AppShell></RealtimeProvider></ToastProvider></AuthProvider></LocaleProvider></body>
    </html>
  );
}
