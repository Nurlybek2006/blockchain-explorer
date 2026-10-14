import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/providers/auth-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { Navigation } from "@/components/layout/navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Blockchain Explorer | Ethereum intelligence", template: "%s | Blockchain Explorer" },
  description: "Explore Ethereum Sepolia blocks, transactions and tokens. Track portfolios, watchlists and on-chain alerts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><a className="skip-link" href="#main-content">Skip to content</a><AuthProvider><ToastProvider><div className="app-shell"><Navigation /><main id="main-content" className="main-content">{children}<footer className="app-footer"><span>Blockchain Explorer</span><span>Ethereum Sepolia · All timestamps in UTC</span></footer></main></div></ToastProvider></AuthProvider></body>
    </html>
  );
}
