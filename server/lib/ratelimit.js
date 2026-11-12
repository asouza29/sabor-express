'use strict';
const { AppError } = require('./errors');

/**
 * Limitador de taxa em memória (janela fixa). Adequado a uma instância única;
 * com várias instâncias, usar um armazenamento compartilhado (ex.: Redis).
 */
function createRateLimiter({ enabled = true, windowMs, max, key = (ctx) => ctx.ip }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, 60_000);
  timer.unref();

  return function rateLimit(ctx) {
    if (!enabled) return;
    const k = String(key(ctx));
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      ctx.res.setHeader('Retry-After', String(retry));
      throw new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um pouco e tente novamente.', { retry_after: retry });
    }
  };
}

module.exports = { createRateLimiter };
