'use strict';

/**
 * Máquina de estados do pedido. Cada transição lista os papéis autorizados.
 * 'sistema' = confirmação de pagamento (webhook do gateway ou confirmação manual do admin,
 * ambas passando pela mesma função de pagamento — não existe atalho genérico para "novo").
 */
const STATUS = Object.freeze({
  AWAITING_PAYMENT: 'aguardando_pagamento',
  NEW: 'novo',
  PREPARING: 'preparando',
  READY: 'pronto',
  ON_THE_WAY: 'a_caminho',
  DELIVERED: 'entregue',
  CANCELED: 'cancelado',
});

const TRANSITIONS = Object.freeze({
  aguardando_pagamento: { novo: ['sistema'], cancelado: ['cliente', 'sistema', 'admin'] },
  novo: { preparando: ['estabelecimento', 'admin'], cancelado: ['cliente', 'estabelecimento', 'admin'] },
  preparando: { pronto: ['estabelecimento', 'admin'], cancelado: ['estabelecimento', 'admin'] },
  pronto: { a_caminho: ['entregador', 'admin'], cancelado: ['estabelecimento', 'admin'] },
  a_caminho: { entregue: ['entregador', 'admin'], cancelado: ['admin'] },
  entregue: {},
  cancelado: {},
});

const FINAL = new Set(['entregue', 'cancelado']);
/** Estados em andamento do ponto de vista do restaurante (pedidos aguardando pagamento ficam ocultos). */
const RESTAURANT_ACTIVE = ['novo', 'preparando', 'pronto', 'a_caminho'];

const canTransition = (from, to, role) => Boolean(TRANSITIONS[from]?.[to]?.includes(role));
const nextStatuses = (from, role) =>
  Object.entries(TRANSITIONS[from] || {}).filter(([, roles]) => roles.includes(role)).map(([to]) => to);

module.exports = { STATUS, TRANSITIONS, FINAL, RESTAURANT_ACTIVE, canTransition, nextStatuses };
