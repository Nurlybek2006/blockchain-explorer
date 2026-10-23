"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  AddressLink,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Modal,
  PageHeading,
  Skeleton,
  StatCard,
  Table,
} from "@/components/ui";
import { useResource } from "@/hooks/use-resource";
import { portfolioApi } from "@/lib/api/portfolio.api";
import {
  formatDecimal,
  formatPercentage,
  formatTokenAmount,
  formatUsd,
} from "@/lib/format";
import { useToast } from "@/providers/toast-provider";
import {
  PortfolioAnalytics,
  PortfolioHistory,
} from "../analytics/portfolio-analytics";
import { ConfirmDialog, NameForm } from "./forms";
import { changeClass, valuationDisplay } from "./portfolio-display";
import styles from "./portfolio.module.css";
import { useTranslation } from "@/hooks/use-translation";
import { PortfolioActivity } from "./portfolio-activity";

export function PortfolioDetail({ id }: { id: string }) {
  const { t, locale } = useTranslation();
  const resource = useResource(
    useCallback(
      (signal: AbortSignal) => portfolioApi.valuation(id, signal),
      [id],
    ),
    { pollInterval: 30000 },
  );
  const allocations = useResource(
    useCallback(
      (signal: AbortSignal) => portfolioApi.analytics(id, signal),
      [id],
    ),
    { pollInterval: 60000 },
  );
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  if (resource.error)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  if (!resource.data || resource.data.portfolio.id !== id)
    return (
      <div className="page-stack">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  const { portfolio, summary, holdings } = resource.data;
  const display = valuationDisplay(summary, locale);
  return (
    <div className="page-stack">
      <Link href="/portfolio" className="muted">
        {t("portfolio.all")}
      </Link>
      <PageHeading
        eyebrow={t("portfolio.title")}
        title={portfolio.name}
        description={t("portfolio.detailDescription")}
        action={
          <div className="actions">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("portfolio.rename")}
            </Button>
            <Button variant="danger" onClick={() => setArchiving(true)}>
              {t("portfolio.archive")}
            </Button>
          </div>
        }
      />
      <div className="actions">
        <AddressLink address={portfolio.walletAddress} />
        <CopyButton value={portfolio.walletAddress} />
        {portfolio.isPrimary && <Badge>{t("portfolio.primaryWallet")}</Badge>}
      </div>
      <div className="stats-grid">
        <StatCard
          label={t("portfolio.totalValue")}
          value={
            <span title={summary.totalValueUsd ?? t("portfolio.unavailable")}>
              {display.total}
            </span>
          }
          note={display.valueNote}
        />
        <StatCard
          label={t("portfolio.marketChange")}
          value={
            <span className={changeClass(summary.change24hPercent)}>
              {display.change}
            </span>
          }
          note={`${display.changeUsd} · ${display.changeNote}`}
        />
        <StatCard
          label={t("portfolio.assets")}
          value={summary.assetCount}
          note={t("portfolio.observedAssets")}
        />
        <StatCard
          label={t("portfolio.pricedAssets")}
          value={summary.pricedAssetCount}
          note={
            display.stale
              ? t(
                  summary.staleAssetCount === 1
                    ? "portfolio.staleCountOne"
                    : "portfolio.staleCount",
                  { count: summary.staleAssetCount },
                )
              : t("portfolio.freshness")
          }
        />
        <StatCard
          label={t("portfolio.unpricedAssets")}
          value={summary.unpricedAssetCount}
          note={t("portfolio.excluded")}
        />
      </div>
      {display.stale && (
        <p className="muted" role="status">
          {t("portfolio.staleNotice")}
        </p>
      )}
      {!summary.complete && (
        <p className="muted" role="status">
          {t("portfolio.incompleteNotice", { subtotal: display.subtotal })}
        </p>
      )}
      <Card
        title={t("portfolio.holdings")}
        action={
          <Button variant="ghost" onClick={resource.reload}>
            {t("portfolio.refresh")}
          </Button>
        }
      >
        {!holdings.length ? (
          <EmptyState
            title={t("portfolio.waitingSync")}
            description={t("portfolio.syncDescription")}
          />
        ) : (
          <Table label={t("portfolio.holdingsTable")}>
            <thead>
              <tr>
                <th>{t("portfolio.asset")}</th>
                <th>{t("portfolio.balance")}</th>
                <th>{t("portfolio.price")}</th>
                <th>{t("portfolio.value")}</th>
                <th>{t("portfolio.change24h")}</th>
                <th>{t("portfolio.allocation")}</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => {
                const allocation = allocations.data?.allocation.find(
                  (item) => item.assetKey === holding.assetKey,
                );
                return (
                  <tr key={holding.assetKey}>
                    <td>
                      <div className={styles.assetName}>
                        {holding.tokenAddress ? (
                          <Link href={`/token/${holding.tokenAddress}`}>
                            {holding.symbol}
                          </Link>
                        ) : (
                          <strong>{holding.symbol}</strong>
                        )}
                        {holding.priceStale && (
                          <Badge>{t("portfolio.stale")}</Badge>
                        )}
                      </div>
                      <small className="muted">
                        {holding.name ??
                          t(
                            holding.tokenAddress
                              ? "portfolio.erc20"
                              : "portfolio.native",
                          )}
                      </small>
                    </td>
                    <td
                      className="mono"
                      title={t("portfolio.amountTooltip", {
                        amount: holding.balanceFormatted,
                        symbol: holding.symbol,
                        raw: holding.balanceRaw,
                      })}
                    >
                      {formatTokenAmount(
                        holding.balanceRaw,
                        holding.decimals,
                        6,
                        locale,
                      )}
                    </td>
                    <td
                      className="mono"
                      title={
                        holding.priceUsd ?? t("portfolio.priceUnavailable")
                      }
                    >
                      {formatUsd(holding.priceUsd, locale)}
                    </td>
                    <td
                      className="mono"
                      title={
                        holding.valueUsd ?? t("portfolio.valueUnavailable")
                      }
                    >
                      {formatUsd(holding.valueUsd, locale)}
                    </td>
                    <td className={changeClass(holding.change24hPercent)}>
                      {formatPercentage(holding.change24hPercent, locale)}
                    </td>
                    <td title={t("portfolio.allocationShare")}>
                      {allocation
                        ? `${formatDecimal(allocation.percentage, locale)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="muted">{t("portfolio.allocationNotice")}</p>
      </Card>
      <PortfolioActivity
        key={`${id}:${portfolio.walletAddress}`}
        address={portfolio.walletAddress}
      />
      <PortfolioHistory key={id} id={id} />
      <PortfolioAnalytics
        data={allocations.data}
        error={allocations.error}
        retry={allocations.reload}
      />
      {editing && (
        <Modal
          title={t("portfolio.renameTitle")}
          onClose={() => setEditing(false)}
        >
          <NameForm
            initialName={portfolio.name}
            submitLabel={t("portfolio.saveName")}
            onSubmit={async (name) => {
              await portfolioApi.rename(id, { name });
              setEditing(false);
              resource.reload();
              notify("portfolio.renamed", "success");
            }}
          />
        </Modal>
      )}
      {archiving && (
        <ConfirmDialog
          title={t("portfolio.archiveTitle")}
          description={t("portfolio.archiveDescription")}
          confirmLabel={t("portfolio.archiveConfirm")}
          onClose={() => setArchiving(false)}
          onConfirm={async () => {
            await portfolioApi.archive(id);
            setArchiving(false);
            notify("portfolio.archived", "success");
            router.replace("/portfolio");
          }}
        />
      )}
    </div>
  );
}
