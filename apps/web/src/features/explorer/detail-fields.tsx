import type { ReactNode } from 'react';
import { CopyButton } from '@/components/ui';
import styles from './explorer.module.css';

export function DetailFields({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  return <dl className={styles.detailGrid}>{fields.map((field) => <div className={styles.detailRow} key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>;
}

export function CopyValue({ value }: { value: string }) {
  return <span className={styles.copyValue}><span className={styles.mono}>{value}</span><CopyButton value={value} /></span>;
}
