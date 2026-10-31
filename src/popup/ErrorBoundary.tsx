import { Component, type ReactNode } from 'react';
import { resolveLanguage, text } from '../i18n';
import type { Language } from '../shared/model';
// Preserve the release's reload fallback without its telemetry dependency.
export class ErrorBoundary extends Component<
  { children: ReactNode; language: Language },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const language = this.props.language ?? resolveLanguage(undefined);
    return (
      <section className="card">
        <h1>{text(language, 'renderFailure')}</h1>
        <p className="description">{text(language, 'renderFailureHelp')}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            {text(language, 'reload')}
          </button>
        </div>
      </section>
    );
  }
}
