import { useEffect } from 'react';
import { browserLogger } from '../lib/browserLogger';

interface AppErrorBoundaryProps {
  error: unknown;
  reset?: () => void;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getErrorStack(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export function AppErrorBoundary({ error, reset }: AppErrorBoundaryProps) {
  useEffect(() => {
    browserLogger.error('router', 'TanStack route error boundary caught error', {
      message: getErrorMessage(error),
      stack: getErrorStack(error),
    });
  }, [error]);

  return (
    <section
      style={{
        display: 'grid',
        gap: '1rem',
        padding: '1rem',
        border: '1px solid rgba(125, 31, 31, 0.22)',
        borderRadius: '20px',
        color: '#7d1f1f',
        background: 'rgba(255, 226, 220, 0.9)',
      }}
    >
      <div>
        <p
          style={{
            margin: '0 0 0.25rem',
            fontSize: '0.8rem',
            fontWeight: 900,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Ошибка страницы
        </p>
        <h2 style={{ margin: 0 }}>{getErrorMessage(error)}</h2>
      </div>

      <pre
        style={{
          maxHeight: '420px',
          overflow: 'auto',
          margin: 0,
          padding: '1rem',
          borderRadius: '14px',
          color: '#5d1616',
          background: 'rgba(255, 255, 255, 0.72)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {getErrorStack(error)}
      </pre>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem' }}>
        <button
          type="button"
          onClick={() => {
            window.location.assign('/rpg');
          }}
          style={{
            justifySelf: 'start',
            padding: '0.7rem 1rem',
            border: 0,
            borderRadius: '999px',
            color: '#fff',
            background: '#153d45',
            cursor: 'pointer',
            fontWeight: 800,
          }}
        >
          Открыть новую НРИ-страницу
        </button>

        {reset ? (
        <button
          type="button"
          onClick={reset}
          style={{
            justifySelf: 'start',
            padding: '0.7rem 1rem',
            border: 0,
            borderRadius: '999px',
            color: '#fff',
            background: '#7d1f1f',
            cursor: 'pointer',
            fontWeight: 800,
          }}
        >
          Попробовать снова
        </button>
        ) : null}
      </div>
    </section>
  );
}
