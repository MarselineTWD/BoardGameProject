const enabled =
  import.meta.env.DEV ||
  window.localStorage.getItem('meeple-scope-debug') === 'true';

function serialize(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

export const browserLogger = {
  debug(scope: string, message: string, details?: unknown) {
    if (!enabled) {
      return;
    }

    console.debug(`[MeepleScope:${scope}] ${message}`, serialize(details));
  },

  info(scope: string, message: string, details?: unknown) {
    if (!enabled) {
      return;
    }

    console.info(`[MeepleScope:${scope}] ${message}`, serialize(details));
  },

  warn(scope: string, message: string, details?: unknown) {
    console.warn(`[MeepleScope:${scope}] ${message}`, serialize(details));
  },

  error(scope: string, message: string, details?: unknown) {
    console.error(`[MeepleScope:${scope}] ${message}`, serialize(details));
  },
};
