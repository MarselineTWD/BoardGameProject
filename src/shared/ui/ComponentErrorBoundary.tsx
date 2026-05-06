import { Component, ErrorInfo, ReactNode } from 'react';
import { browserLogger } from '../lib/browserLogger';

interface ComponentErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  scope: string;
}

interface ComponentErrorBoundaryState {
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  state: ComponentErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ComponentErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    browserLogger.error(this.props.scope, 'component error boundary caught error', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: '1rem',
              border: '1px solid rgba(125, 31, 31, 0.22)',
              borderRadius: '18px',
              color: '#7d1f1f',
              background: 'rgba(255, 226, 220, 0.82)',
            }}
          >
            Не удалось отрисовать блок: {this.state.error.message}
          </div>
        )
      );
    }

    return this.props.children;
  }
}
