'use strict';

/** Preço efetivo do produto: promocional (se existir e for menor) ou o preço normal. Valores em centavos. */
function effectivePrice(product) {
  const promo = product.promo_price_cents;
  return promo != null && promo < product.price_cents ? promo : product.price_cents;
}

const hasPromo = (product) => effectivePrice(product) < product.price_cents;

module.exports = { effectivePrice, hasPromo };
