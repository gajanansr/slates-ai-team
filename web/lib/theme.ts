import { PALETTES, PALETTE_IDS, PALETTE_KEY, isPalette } from '@/lib/palettes';
import { customCss, makeCustomPalette } from '@/lib/custom-palette';

export const CUSTOM_CSS_KEY = 'slates-palette-css';
export const CUSTOM_PAGES_KEY = 'slates-palette-pages';
const CUSTOM_STYLE_ID = 'slates-custom-palette';

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'slates-theme';
export const THEME_COLORS = { light: '#f1f2ec', dark: '#0d1210' } as const;

const PAGE_COLORS = JSON.stringify(Object.fromEntries(PALETTE_IDS.map((id) => [id, { light: PALETTES[id].light.page, dark: PALETTES[id].dark.page }])));

/**
 * Runs inline in <head> before first paint: resolves the saved preference and sets
 * <html data-theme>, so there is never a flash of the wrong theme. It also sets the browser
 * chrome colour (status bar and Android's bottom bar) to match the app, not the phone's own
 * light/dark setting: the media-qualified theme-color tags follow the OS, so they are made unconditional.
 */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var m=d?'dark':'light';document.documentElement.dataset.theme=m;var q=localStorage.getItem('${PALETTE_KEY}');var pal=null;var cp=null;if(q&&/^\\/(home|boards|s|notes|reminders|agents|activity|settings|profile|admin|inbox|ask|pair|oauth)(\\/|$)/.test(location.pathname)){document.documentElement.dataset.palette=q;pal=q;if(q==='custom'){var css=localStorage.getItem('${CUSTOM_CSS_KEY}'),pg=localStorage.getItem('${CUSTOM_PAGES_KEY}');if(css&&pg){cp=JSON.parse(pg);var st=document.createElement('style');st.id='${CUSTOM_STYLE_ID}';st.dataset.pages=pg;st.textContent=css;document.head.appendChild(st);}}}var C=${PAGE_COLORS};var c=cp?cp[m]:pal&&C[pal]?C[pal][m]:(m==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}');var t=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<t.length;i++){t[i].removeAttribute('media');t[i].setAttribute('content',c);}}catch(e){}})();`;

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const mode = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = mode;
  const pal = document.documentElement.dataset.palette;
  const custom = pal === 'custom' ? document.getElementById(CUSTOM_STYLE_ID)?.dataset.pages : undefined;
  const color = custom ? (JSON.parse(custom) as Record<string, string>)[mode] : pal && isPalette(pal) ? PALETTES[pal][mode].page : THEME_COLORS[mode];
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.removeAttribute('media'); // the media-qualified tags follow the phone's theme, not the app's
    m.setAttribute('content', color);
  }
  return mode;
}

export function savePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: still applies for this session */
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent('slates-theme', { detail: pref }));
}

/**
 * Apply (or clear) the palette on <html>. `remember` keeps it for the next cold start, before the server answers.
 * With `accent` (#rrggbb) the custom palette is generated from that one colour and wins over `id`.
 */
export function applyPalette(id: string | undefined, remember = true, accent?: string) {
  const root = document.documentElement;
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  let custom = false;
  if (accent) {
    const p = makeCustomPalette(accent);
    const el = document.createElement('style');
    el.id = CUSTOM_STYLE_ID;
    el.dataset.pages = JSON.stringify(p.pages);
    el.textContent = customCss(p);
    document.head.appendChild(el);
    root.dataset.palette = 'custom';
    custom = true;
    if (remember) {
      try {
        localStorage.setItem(PALETTE_KEY, 'custom');
        localStorage.setItem(CUSTOM_CSS_KEY, el.textContent);
        localStorage.setItem(CUSTOM_PAGES_KEY, el.dataset.pages);
      } catch {
        /* private mode */
      }
    }
  } else if (id && isPalette(id) && id !== 'lime') root.dataset.palette = id;
  else delete root.dataset.palette;
  if (remember && !custom) {
    try {
      localStorage.removeItem(CUSTOM_CSS_KEY);
      localStorage.removeItem(CUSTOM_PAGES_KEY);
      if (id && isPalette(id) && id !== 'lime') localStorage.setItem(PALETTE_KEY, id);
      else localStorage.removeItem(PALETTE_KEY);
    } catch {
      /* private mode */
    }
  }
  applyTheme(readPref());
}
