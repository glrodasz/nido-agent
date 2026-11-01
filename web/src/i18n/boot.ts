import * as core from "./locale";

/** The blocking <head> script that sends an unprefixed first visit to the saved or browser
 * language before anything paints. It inlines the core's own functions and settings, so the boot
 * script and the app never disagree. */
export function localeBootScript(): string {
  const parts = Object.entries(core).map(([name, value]) =>
    typeof value === "function" ? String(value) : `var ${name}=${JSON.stringify(value ?? null)};`,
  );
  const run = `var r=document.documentElement;try{var t=resolveLocaleRedirect({pathname:location.pathname,savedLocale:readCookie(document.cookie,LOCALE_COOKIE),languages:navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language]});if(t){r.setAttribute("data-locale-pending","");setTimeout(function(){r.removeAttribute("data-locale-pending")},300);location.replace(t+location.search+location.hash)}}catch(e){r.removeAttribute("data-locale-pending")}`;
  return `(function(){${parts.join("\n")}\n${run}})();`;
}
