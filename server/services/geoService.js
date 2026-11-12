'use strict';
const { isValidCoord } = require('../domain/geo');

/**
 * Resolução de coordenadas no BACKEND.
 *  1) Geocodificador do servidor (fonte preferida);
 *  2) coordenadas do aparelho (GPS), somente se ALLOW_DEVICE_COORDS estiver ativo;
 *  3) sem coordenadas => o endereço/loja fica sem elegibilidade de entrega.
 */
function createGeoService({ db, geocoder, config }) {
  const addressText = (a) => [
    [a.street, a.number].filter(Boolean).join(', '),
    a.neighborhood,
    [a.city, a.state].filter(Boolean).join(' - '),
    a.zip,
    'Brasil',
  ].filter(Boolean).join(', ');

  async function resolveCoordinates(text, deviceLat, deviceLng) {
    let geoError = false;
    if (geocoder.enabled) {
      try {
        const r = await geocoder.geocode(text);
        if (r && isValidCoord(r.lat, r.lng)) {
          return { coords: { lat: r.lat, lng: r.lng, source: 'geocoder' }, geoError: false };
        }
      } catch {
        geoError = true;
      }
    }
    if (config.allowDeviceCoords && isValidCoord(deviceLat, deviceLng)) {
      return { coords: { lat: deviceLat, lng: deviceLng, source: 'device' }, geoError };
    }
    return { coords: null, geoError };
  }

  /**
   * Tenta preencher coordenadas ausentes de um endereço/loja já salvo.
   * O UPDATE só vale se a linha não foi editada nesse meio-tempo (updated_at igual).
   */
  async function fillMissingCoords(table, row) {
    if (table !== 'addresses' && table !== 'restaurants') throw new Error('tabela inválida');
    if (!geocoder.enabled) return { filled: false, geoError: false };
    try {
      const r = await geocoder.geocode(addressText(row));
      if (r && isValidCoord(r.lat, r.lng)) {
        const res = db.run(
          `UPDATE ${table} SET lat = ?, lng = ?, coords_source = 'geocoder' WHERE id = ? AND lat IS NULL AND updated_at = ?`,
          r.lat, r.lng, row.id, row.updated_at,
        );
        return { filled: res.changes === 1, geoError: false };
      }
      return { filled: false, geoError: false };
    } catch {
      return { filled: false, geoError: true };
    }
  }

  return { addressText, resolveCoordinates, fillMissingCoords };
}

module.exports = { createGeoService };
