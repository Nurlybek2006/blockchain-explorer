import { CopyButton } from '@/components/ui';
import styles from './advanced.module.css';
export function CodePanel({ title, value }: { title: string; value: string }) { return <><div className={styles.panelHeading}><h3>{title}</h3><CopyButton value={value} label={`Copy ${title.toLowerCase()}`} /></div><pre className={styles.code} tabIndex={0} aria-label={title}>{value}</pre></>; }
