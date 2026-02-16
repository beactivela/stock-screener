import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Catches React render errors and displays a fallback instead of a blank screen.
 * Use around components that may throw (e.g. StockDetail with edge-case data).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-6 text-red-200">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
          <pre className="text-sm overflow-auto max-h-48 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
