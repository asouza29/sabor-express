'use strict';

// Raio médio da Terra (IUGG), em metros.
const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Coordenada utilizável: números finitos dentro dos limites e diferente de (0,0). */
function isValidCoord(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0) // "Null Island": valor típico de coordenada não preenchida
  );
}

/** Distância em linha reta (grande círculo / Haversine), em metros. */
function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ponto a `meters` metros ao norte de `p` (útil em testes e verificações). */
function destinationNorth(p, meters) {
  return { lat: p.lat + (meters / EARTH_RADIUS_M) * (180 / Math.PI), lng: p.lng };
}

/** Caixa delimitadora (em graus) que contém todos os pontos a até `meters` de (lat,lng). */
function boundingBox(lat, lng, meters) {
  const dLat = (meters / 110_000);
  const cos = Math.max(0.01, Math.cos(toRad(lat)));
  const dLng = meters / (110_000 * cos);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

module.exports = { EARTH_RADIUS_M, isValidCoord, haversineMeters, destinationNorth, boundingBox };
