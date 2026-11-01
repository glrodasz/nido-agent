// The page's language and its strings. A page renders in one locale for its whole life (switching
// language loads another URL), so `t` is set once from the URL. Outside a browser (unit tests)
// it starts in English.
import { INTL_LOCALES, type Locale, pageLocale } from "./locale";
import en, { type Messages, type Plural } from "./messages/en";
import es from "./messages/es";
import pt from "./messages/pt";

export type { Messages, Plural };
export const MESSAGES: Record<Locale, Messages> = { es, en, pt };

const initial: Locale = typeof location === "undefined" ? "en" : pageLocale(location.pathname);

export let locale: Locale = initial;
export let t: Messages = MESSAGES[initial];

export function setLocale(next: Locale): void {
  locale = next;
  t = MESSAGES[next];
}

/** BCP 47 tag for Intl and toLocale*String. */
export const intlLocale = () => INTL_LOCALES[locale];

/** "Hello {name}" with { name: "Ana" } -> "Hello Ana". Unknown placeholders stay as written. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

/** A count with its noun in the page's language: "1 search", "3 búsquedas". */
export function plural(count: number, forms: Plural): string {
  const form = new Intl.PluralRules(intlLocale()).select(count) === "one" ? forms.one : forms.other;
  return fmt(form, { n: formatNumber(count) });
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(n);
}

/** A TMDB genre name (always English in requests) as the page shows it. */
export const genreLabel = (genre: string) => t.genres[genre] ?? genre;
