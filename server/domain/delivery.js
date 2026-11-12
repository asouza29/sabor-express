'use strict';
const { isValidCoord, haversineMeters } = require('./geo');

/**
 * REGRA DEFINITIVA DE ENTREGA — 15 km.
 * Substitui integralmente o limite anterior de 60 km (revogado).
 *
 * Decisões de implementação (documentadas para revisão):
 *  - Ponto de referência: distância entre a localização do ESTABELECIMENTO e o
 *    ENDEREÇO DE ENTREGA do cliente (conforme a pergunta 10 do levantamento).
 *  - Metodologia: distância em linha reta (Haversine), NÃO a rota pelas ruas.
 *  - Arredondamento: a distância é arredondada para o metro mais próximo antes da comparação.
 *  - Limite INCLUSIVO: exatamente 15.000 m é permitido; 15.001 m é recusado.
 *  - Sem coordenadas válidas => sem elegibilidade (nunca se aprova por falta de dados).
 */
const MAX_DELIVERY_KM = 15;
const MAX_DELIVERY_METERS = MAX_DELIVERY_KM * 1000;

/** Rótulo em km com 1 casa, arredondando para cima (nunca mostra "≤ 15,0" para uma distância recusada). */
const kmLabel = (meters) => Math.ceil(meters / 100) / 10;

/**
 * @param {{lat:number,lng:number}} from  localização do estabelecimento
 * @param {{lat:number,lng:number}} to    endereço de entrega
 * @returns {{ok:boolean, code:'OK'|'OUT_OF_RANGE'|'ADDRESS_NO_COORDS'|'RESTAURANT_NO_COORDS', distanceMeters:number|null}}
 */
function evaluateDelivery(from, to) {
  if (!isValidCoord(from?.lat, from?.lng)) return { ok: false, code: 'RESTAURANT_NO_COORDS', distanceMeters: null };
  if (!isValidCoord(to?.lat, to?.lng)) return { ok: false, code: 'ADDRESS_NO_COORDS', distanceMeters: null };
  const distanceMeters = Math.round(haversineMeters(from, to));
  if (distanceMeters > MAX_DELIVERY_METERS) return { ok: false, code: 'OUT_OF_RANGE', distanceMeters };
  return { ok: true, code: 'OK', distanceMeters };
}

const MESSAGES = {
  OUT_OF_RANGE: (d) => `Este restaurante está a ${String(kmLabel(d)).replace('.', ',')} km do endereço de entrega. Entregamos somente em até ${MAX_DELIVERY_KM} km.`,
  ADDRESS_NO_COORDS: () => 'Não foi possível confirmar a localização deste endereço. Edite o endereço ou use sua localização atual para continuar.',
  RESTAURANT_NO_COORDS: () => 'Este restaurante ainda não tem localização confirmada e não pode receber pedidos.',
  GEO_UNAVAILABLE: () => 'O serviço de localização está indisponível no momento. Tente novamente em instantes.',
};

const STATUS = { OUT_OF_RANGE: 422, ADDRESS_NO_COORDS: 422, RESTAURANT_NO_COORDS: 422, GEO_UNAVAILABLE: 503 };

function deliveryMessage(code, distanceMeters) {
  return (MESSAGES[code] || (() => 'Entrega indisponível.'))(distanceMeters);
}

module.exports = {
  MAX_DELIVERY_KM, MAX_DELIVERY_METERS, kmLabel,
  evaluateDelivery, deliveryMessage, DELIVERY_ERROR_STATUS: STATUS,
};
