'use strict';
const { AppError } = require('../lib/errors');
const v = require('../lib/validate');
const { isValidCoord } = require('../domain/geo');
const { nowIso, idParam } = require('./common');

const MAX_ADDRESSES = 10;
const TEXT_FIELDS = ['street', 'number', 'neighborhood', 'city', 'state', 'zip'];

function createAddressService({ db, geo }) {
  const pub = (a) => ({
    id: a.id, label: a.label, street: a.street, number: a.number, complement: a.complement,
    neighborhood: a.neighborhood, city: a.city, state: a.state, zip: a.zip,
    lat: a.lat, lng: a.lng, coords_source: a.coords_source,
    has_coords: isValidCoord(a.lat, a.lng), updated_at: a.updated_at,
  });

  function parse(body) {
    return {
      label: v.str(body, 'label', { label: 'Apelido', optional: true, max: 30 }) || 'Casa',
      street: v.str(body, 'street', { label: 'Rua', max: 120 }),
      number: v.str(body, 'number', { label: 'Número', max: 20 }),
      complement: v.str(body, 'complement', { label: 'Complemento', optional: true, max: 60 }),
      neighborhood: v.str(body, 'neighborhood', { label: 'Bairro', max: 80 }),
      city: v.str(body, 'city', { label: 'Cidade', max: 80 }),
      state: v.uf(body, 'state'),
      zip: v.zip(body, 'zip'),
      deviceLat: v.num(body, 'device_lat', { label: 'Latitude', min: -90, max: 90, optional: true }),
      deviceLng: v.num(body, 'device_lng', { label: 'Longitude', min: -180, max: 180, optional: true }),
    };
  }

  const list = (user) => db.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY id', user.id).map(pub);

  function own(user, id) {
    const a = db.get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', idParam(id), user.id);
    if (!a) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Endereço não encontrado.');
    return a;
  }

  async function create(user, body) {
    const f = parse(body);
    if (db.get('SELECT COUNT(*) AS c FROM addresses WHERE user_id = ?', user.id).c >= MAX_ADDRESSES) {
      throw new AppError(409, 'TOO_MANY_ADDRESSES', `Você pode cadastrar até ${MAX_ADDRESSES} endereços.`);
    }
    const { coords, geoError } = await geo.resolveCoordinates(geo.addressText(f), f.deviceLat, f.deviceLng);
    const r = db.run(
      `INSERT INTO addresses (user_id, label, street, number, complement, neighborhood, city, state, zip, lat, lng, coords_source, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      user.id, f.label, f.street, f.number, f.complement, f.neighborhood, f.city, f.state, f.zip,
      coords?.lat, coords?.lng, coords?.source, nowIso(),
    );
    const row = db.get('SELECT * FROM addresses WHERE id = ?', r.id);
    return { address: pub(row), location_confirmed: Boolean(coords), geo_unavailable: !coords && geoError };
  }

  async function update(user, id, body) {
    const current = own(user, id);
    const f = parse(body);
    const textChanged = TEXT_FIELDS.some((k) => (f[k] ?? null) !== (current[k] ?? null));
    const deviceProvided = f.deviceLat != null && f.deviceLng != null;
    let lat = current.lat;
    let lng = current.lng;
    let source = current.coords_source;
    let geoError = false;
    let confirmed = isValidCoord(lat, lng);
    if (textChanged || deviceProvided) {
      // Coordenadas antigas NUNCA são mantidas quando o texto do endereço muda.
      const r = await geo.resolveCoordinates(geo.addressText(f), f.deviceLat, f.deviceLng);
      lat = r.coords?.lat ?? null;
      lng = r.coords?.lng ?? null;
      source = r.coords?.source ?? null;
      geoError = r.geoError;
      confirmed = Boolean(r.coords);
    }
    db.run(
      `UPDATE addresses SET label=?, street=?, number=?, complement=?, neighborhood=?, city=?, state=?, zip=?,
       lat=?, lng=?, coords_source=?, updated_at=? WHERE id=? AND user_id=?`,
      f.label, f.street, f.number, f.complement, f.neighborhood, f.city, f.state, f.zip,
      lat, lng, source, nowIso(), current.id, user.id,
    );
    const row = db.get('SELECT * FROM addresses WHERE id = ?', current.id);
    return { address: pub(row), location_confirmed: confirmed, geo_unavailable: !confirmed && geoError };
  }

  function remove(user, id) {
    const a = own(user, id);
    db.run('DELETE FROM addresses WHERE id = ?', a.id);
  }

  return { pub, list, create, update, remove, own };
}

module.exports = { createAddressService };
