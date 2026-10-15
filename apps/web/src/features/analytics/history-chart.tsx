'use client';

import { useId, useState, type PointerEvent } from 'react';
import type { PortfolioHistoryResponse } from '@blockchain-explorer/contracts';
import { EmptyState, Table } from '@/components/ui';
import { formatDateTime, formatDecimal, formatUsd } from '@/lib/format';
import { historyExtrema, historyGeometry } from './history-geometry';
import styles from './analytics.module.css';
import { useTranslation } from '@/hooks/use-translation';
export function HistoryChart({ points }: { points: PortfolioHistoryResponse['points'] }) {
  const { t, locale } = useTranslation();
  const labelId = useId();
  const [selected, setSelected] = useState(0);
  if (!points.length) return <EmptyState title={t('portfolio.analytics.noSnapshots')} description={t('portfolio.analytics.noSnapshotsDescription')} />;
  const geometry = historyGeometry(points);
  const currentIndex = Math.min(selected, points.length - 1);
  const current = points[currentIndex];
  const position = geometry[currentIndex];
  const path = geometry.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const { maxIndex, minIndex } = historyExtrema(points);
  function selectPoint(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 900;
    let nearest = 0;
    geometry.forEach((point, index) => { if (Math.abs(point.x - x) < Math.abs(geometry[nearest].x - x)) nearest = index; });
    setSelected(nearest);
  }
  return <div className={styles.chart}>
    <div id={labelId} className={styles.chartValue} aria-live="polite" aria-atomic="true"><strong title={`USD ${current.valueUsd}`}>{formatUsd(current.valueUsd, locale)}</strong><span className="muted">{formatDateTime(current.timestamp, locale)}</span></div>
    <svg viewBox="0 0 900 235" aria-labelledby={labelId} role="img" tabIndex={0} className={styles.svg}
      onPointerMove={selectPoint} onPointerDown={selectPoint}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))); } if (event.key === 'Home') { event.preventDefault(); setSelected(0); } if (event.key === 'End') { event.preventDefault(); setSelected(points.length - 1); } }}>
      <title>{t('portfolio.analytics.chartTitle')}</title>
      {[25, 115, 205].map(y => <line key={y} x1="30" x2="870" y1={y} y2={y} className={styles.gridLine} />)}
      <path d={path} fill="none" className={styles.line} />
      <line x1={position.x} x2={position.x} y1="25" y2="205" className={styles.crosshair} />
      <circle cx={position.x} cy={position.y} r="5" className={styles.point} />
    </svg>
    <div className={styles.axis}><span>{formatDateTime(points[0].timestamp, locale)}</span><span>{formatDateTime(points[points.length - 1].timestamp, locale)}</span></div>
    <div className={styles.axis}><span>{t('portfolio.analytics.low', { value: formatUsd(points[minIndex].valueUsd, locale) })}</span><span>{t('portfolio.analytics.high', { value: formatUsd(points[maxIndex].valueUsd, locale) })}</span></div>
    <p className="muted">{t('portfolio.analytics.chartInstructions')}</p>
    <details><summary>{t(points.length === 1 ? 'portfolio.analytics.snapshotTable' : 'portfolio.analytics.snapshotsTable', { count: points.length })}</summary><Table label={t('portfolio.analytics.tableLabel')}><thead><tr><th>{t('portfolio.analytics.timestamp')}</th><th>{t('portfolio.analytics.valueUsd')}</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.timestamp}-${index}`}><td>{formatDateTime(point.timestamp, locale)}</td><td className="mono" title={point.valueUsd}>{formatDecimal(point.valueUsd, locale)}</td></tr>)}</tbody></Table></details>
  </div>;
}
