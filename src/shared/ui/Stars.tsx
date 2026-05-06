import styles from './Stars.module.css';

interface StarsProps {
  value: number;
  onChange?: (value: number) => void;
}

export function Stars({ value, onChange }: StarsProps) {
  return (
    <div className={styles.stars}>
      {Array.from({ length: 5 }, (_, index) => {
        const starValue = index + 1;

        if (onChange) {
          return (
            <button
              key={starValue}
              className={`${styles.starButton} ${starValue <= value ? styles.active : ''}`}
              onClick={() => onChange(starValue)}
              type="button"
            >
              ★
            </button>
          );
        }

        return (
          <span
            key={starValue}
            className={`${styles.starText} ${starValue <= value ? styles.active : ''}`}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}
