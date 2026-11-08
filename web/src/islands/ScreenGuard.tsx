import { Component, type ComponentChildren } from "preact";
import { t } from "../i18n";

/**
 * Catches a render error below it. Without it Preact leaves the page half updated and every
 * later tap does nothing; with it the family sees what broke and can reload.
 */
export default class ScreenGuard extends Component<{ children: ComponentChildren }, { error: string | null }> {
  state = { error: null as string | null };

  componentDidCatch(err: unknown) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(err);
    this.setState({ error });
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <section class="panel screen-broke" role="alert">
        <p>{t.app.screenBroke}</p>
        <code>{this.state.error}</code>
        <button type="button" class="btn btn-primary" onClick={() => location.reload()}>
          {t.app.reload}
        </button>
      </section>
    );
  }
}
