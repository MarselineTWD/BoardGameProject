import { DependencyList, useEffect, useMemo, useRef, useState } from 'react';

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useAsyncResource<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
) {
  const loaderRef = useRef(loader);
  const [state, setState] = useState<AsyncResource<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const dependencyKey = JSON.stringify(dependencies);

  loaderRef.current = loader;

  useEffect(() => {
    let active = true;

    setState((current) => ({
      data: current.data,
      loading: true,
      error: null,
    }));

    loaderRef.current()
      .then((data) => {
        if (!active) {
          return;
        }

        setState({
          data,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить данные',
        });
      });

    return () => {
      active = false;
    };
  }, [dependencyKey, reloadKey]);

  const reload = useMemo(() => () => setReloadKey((value) => value + 1), []);

  return {
    ...state,
    reload,
  };
}
