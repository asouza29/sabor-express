// Roteador por hash (#/caminho?consulta). Cada rota devolve um Node (ou Promise<Node>).
const routes = [];
let cleanups = [];
let current = 0;

export const route = (pattern, def) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, ...def });
};

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
  if (replace) location.replace(target); else location.hash = path;
}

export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

/** Registra uma função de limpeza (ex.: parar polling) que roda ao sair da tela. */
export const onLeave = (fn) => { cleanups.push(fn); };

export function runCleanups() {
  const list = cleanups; cleanups = [];
  list.forEach((fn) => { try { fn(); } catch { /* ignora */ } });
}

/** Marca uma navegação; resolve false se outra navegação começou no meio do caminho. */
export const beginNav = () => { current += 1; return current; };
export const isCurrent = (id) => id === current;
