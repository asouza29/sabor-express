'use strict';

/**
 * Geocodificador: converte o texto de um endereço em coordenadas.
 *
 * Interface: { enabled: boolean, geocode(text) => Promise<{lat,lng}|null> }
 *  - retorna null quando o endereço não é encontrado;
 *  - lança exceção quando o serviço está indisponível (rede, timeout, HTTP != 200).
 *
 * Provedor padrão: Nominatim (OpenStreetMap). Atenção à política de uso (1 req/s,
 * User-Agent identificado). Para volume real, usar um provedor comercial implementando
 * a mesma interface.
 */
function createGeocoder(config) {
  if (config.geocoderProvider === 'none') {
    return { enabled: false, async geocode() { return null; } };
  }
  return {
    enabled: true,
    async geocode(text) {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'br');
      url.searchParams.set('q', text);
      const res = await fetch(url, {
        headers: { 'User-Agent': `SaborExpress/1.0 (${config.geocoderContact})`, 'Accept-Language': 'pt-BR' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`Geocodificador respondeu ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const lat = Number(data[0].lat);
      const lng = Number(data[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    },
  };
}

module.exports = { createGeocoder };
