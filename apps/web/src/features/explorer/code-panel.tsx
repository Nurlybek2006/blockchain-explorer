'use client';
import { useTranslation } from '@/hooks/use-translation';
import { CopyButton } from '@/components/ui';
import styles from './advanced.module.css';
export function CodePanel({ title, value }: { title: string; value: string }) {
  const { t } = useTranslation(); return <><div className={styles.panelHeading}><h3>{title}</h3><CopyButton value={value} label={t('explorer.labels.copy', { name: title })} /></div><pre className={styles.code} tabIndex={0} aria-label={title}>{value}</pre></>; }
