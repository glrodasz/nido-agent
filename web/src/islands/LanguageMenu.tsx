import { useEffect, useRef, useState } from "preact/hooks";
import { locale, MESSAGES, t } from "../i18n";
import { LANGUAGE_NAMES, LOCALES, type Locale, switchLocalePath } from "../i18n/locale";
import { persistLocale } from "../i18n/persistLocale";
import Icon from "./Icon";

/** The same page in another language, keeping an invite link's ?invite= and any #section. */
const hrefFor = (target: Locale) =>
  switchLocalePath(location.pathname, target) + location.search + location.hash;

/** One link per language, labelled in its own language and read out in it. */
function LanguageLink({ target }: { target: Locale }) {
  const current = target === locale;
  return (
    <a
      href={hrefFor(target)}
      hreflang={target}
      lang={target}
      aria-current={current ? "true" : undefined}
      aria-label={current ? undefined : MESSAGES[target].lang.switchTo}
      class={current ? "lang-link lang-current" : "lang-link"}
      // Saved on click, not mousedown, so the keyboard saves it too.
      onClick={() => persistLocale(target)}
    >
      {LANGUAGE_NAMES[target]}
    </a>
  );
}

/** Header control: a globe with the current language that opens the list of languages. */
export default function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div class="lang-menu" ref={root}>
      <button
        type="button"
        class="lang-btn"
        aria-expanded={open}
        aria-controls="lang-list"
        aria-label={`${t.lang.menu}: ${LANGUAGE_NAMES[locale]}`}
        title={t.lang.menu}
        onClick={() => setOpen(!open)}
      >
        <Icon name="globe" />
        <span class="lang-code" aria-hidden="true">
          {locale.toUpperCase()}
        </span>
      </button>
      {open && (
        <ul id="lang-list" class="lang-list">
          {LOCALES.map((l) => (
            <li key={l}>
              <LanguageLink target={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Footer row: every language as a plain link, the current one marked. */
export function LanguageLinks() {
  return (
    <nav class="lang-links" aria-label={t.lang.menu}>
      <Icon name="globe" />
      {LOCALES.map((l) => (
        <LanguageLink key={l} target={l} />
      ))}
    </nav>
  );
}
