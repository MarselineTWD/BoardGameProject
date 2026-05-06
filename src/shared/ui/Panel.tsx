import { HTMLAttributes, ReactNode } from 'react';
import styles from './Panel.module.css';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
}

export function Panel({
  title,
  eyebrow,
  description,
  action,
  children,
  className = '',
  ...props
}: PanelProps) {
  return (
    <section className={`${styles.panel} ${className}`.trim()} {...props}>
      {(title || description || action || eyebrow) && (
        <header className={styles.header}>
          <div>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            {title ? <h2 className={styles.title}>{title}</h2> : null}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
