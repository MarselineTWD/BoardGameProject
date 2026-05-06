import { Button } from './Button';
import styles from './StatusBox.module.css';

interface StatusBoxProps {
  kind: 'loading' | 'error' | 'empty';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function StatusBox({
  kind,
  title,
  description,
  actionLabel,
  onAction,
}: StatusBoxProps) {
  return (
    <div className={styles.box}>
      <div className={`${styles.icon} ${styles[kind]}`}>
        {kind === 'loading' ? '...' : kind === 'error' ? '!' : '∅'}
      </div>
      <div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
