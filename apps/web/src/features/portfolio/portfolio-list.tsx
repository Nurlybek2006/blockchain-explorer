"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { PortfolioResponse } from "@blockchain-explorer/contracts";
import {
  AddressLink,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeading,
  Pagination,
  Skeleton,
} from "@/components/ui";
import { useResource } from "@/hooks/use-resource";
import { portfolioApi } from "@/lib/api/portfolio.api";
import { useToast } from "@/providers/toast-provider";
import { ConnectWalletForm } from "./connect-wallet-form";
import { changeClass, valuationDisplay } from "./portfolio-display";
import styles from "./portfolio.module.css";
import { useTranslation } from "@/hooks/use-translation";

function PortfolioCard({ portfolio }: { portfolio: PortfolioResponse }) {
  const { t, locale } = useTranslation();
  const resource = useResource(
    useCallback(
      (signal: AbortSignal) => portfolioApi.valuation(portfolio.id, signal),
      [portfolio.id],
    ),
    { pollInterval: 60000 },
  );
  const display = resource.data
    ? valuationDisplay(resource.data.summary, locale)
    : null;
  return (
    <Card>
      <div className={styles.cardHeading}>
        <Link href={`/portfolio/${portfolio.id}`} className={styles.name}>
          {portfolio.name}
        </Link>
        {portfolio.isPrimary && <Badge>{t("portfolio.primary")}</Badge>}
      </div>
      <AddressLink address={portfolio.walletAddress} />
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !display || !resource.data ? (
        <Skeleton />
      ) : (
        <>
          <p
            className={styles.total}
            title={
              resource.data.summary.totalValueUsd ??
              t("portfolio.totalUnavailable")
            }
          >
            {display.total}
          </p>
          <div className={styles.cardMetrics}>
            <span
              className={changeClass(resource.data.summary.change24hPercent)}
            >
              {display.change}{" "}
              <small className="muted">{t("portfolio.change24h")}</small>
            </span>
            <span className="muted">
              {t(
                resource.data.summary.assetCount === 1
                  ? "portfolio.assetsCountOne"
                  : "portfolio.assetsCount",
                { count: resource.data.summary.assetCount },
              )}
            </span>
          </div>
          <p className="muted">{display.valueNote}</p>
          {display.stale && <Badge>{t("portfolio.stalePricing")}</Badge>}
        </>
      )}
      <Link href={`/portfolio/${portfolio.id}`} className={styles.openLink}>
        {t("portfolio.view")}
      </Link>
    </Card>
  );
}
export function PortfolioList({ page }: { page: number }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  const resource = useResource(
    useCallback(
      (signal: AbortSignal) => portfolioApi.list(page, signal),
      [page],
    ),
  );
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow={t("portfolio.workspace")}
        title={t("portfolio.title")}
        description={t("portfolio.description")}
        action={
          <Button onClick={() => setCreating(true)}>
            {t("portfolio.addWallet")}
          </Button>
        }
      />
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <div className="grid-three">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : !resource.data.items.length ? (
        <EmptyState
          title={t(
            page === 1 ? "portfolio.firstWallet" : "portfolio.emptyPage",
          )}
          description={t("portfolio.connectWallet")}
          action={
            page === 1 ? (
              <Button onClick={() => setCreating(true)}>
                {t("portfolio.create")}
              </Button>
            ) : (
              <Link href="/portfolio">{t("portfolio.firstPage")}</Link>
            )
          }
        />
      ) : (
        <>
          <div className="grid-three">
            {resource.data.items.map((portfolio) => (
              <PortfolioCard key={portfolio.id} portfolio={portfolio} />
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={resource.data.totalPages}
            onPageChange={(next) => router.push(`/portfolio?page=${next}`)}
          />
        </>
      )}
      {creating && (
        <Modal title={t("portfolio.create")} onClose={() => setCreating(false)}>
          <ConnectWalletForm
            onSubmit={async (name, walletAddress) => {
              const result = await portfolioApi.create({
                name,
                walletAddress,
              });

              setCreating(false);
              notify("portfolio.created", "success");
              router.push(`/portfolio/${result.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
