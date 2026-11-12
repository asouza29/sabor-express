// Cliente da API. Todas as regras (preço, 15 km, permissões) são decididas no servidor;
// aqui apenas transportamos dados e traduzimos erros para a interface.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body, { quiet401 = false } = {}) {
  const headers = { 'X-Requested-With': 'SaborExpress', Accept: 'application/json' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet e tente de novo.');
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { /* não-JSON */ } }
  if (!res.ok) {
    const e = data?.error || {};
    if (res.status === 401 && !quiet401) onUnauthorized();
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Algo deu errado. Tente novamente.', e.details);
  }
  return data;
}

export const api = {
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b, o) => request('POST', u, b ?? {}, o),
  put: (u, b, o) => request('PUT', u, b ?? {}, o),
  patch: (u, b, o) => request('PATCH', u, b ?? {}, o),
  del: (u, o) => request('DELETE', u, undefined, o),
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
