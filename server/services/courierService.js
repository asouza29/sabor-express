'use strict';
const v = require('../lib/validate');
const { nowIso } = require('./common');

const VEHICLES = ['moto', 'bicicleta', 'carro', 'a_pe'];

function createCourierService({ db }) {
  function getProfile(user) {
    const p = db.get('SELECT vehicle, available FROM courier_profiles WHERE user_id = ?', user.id)
      || { vehicle: 'moto', available: 0 };
    const stats = db.get(
      `SELECT SUM(CASE WHEN status = 'entregue' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN status NOT IN ('entregue','cancelado') THEN 1 ELSE 0 END) AS active
       FROM orders WHERE courier_id = ?`, user.id,
    );
    return {
      vehicle: p.vehicle, available: Boolean(p.available),
      delivered_count: stats.delivered || 0, active_count: stats.active || 0,
    };
  }

  function updateProfile(user, body) {
    const current = db.get('SELECT * FROM courier_profiles WHERE user_id = ?', user.id);
    const vehicle = v.oneOf(body, 'vehicle', VEHICLES, { label: 'Veículo', optional: true }) ?? current.vehicle;
    const available = v.bool(body, 'available', Boolean(current.available));
    db.run('UPDATE courier_profiles SET vehicle = ?, available = ?, updated_at = ? WHERE user_id = ?', vehicle, available, nowIso(), user.id);
    return getProfile(user);
  }

  return { getProfile, updateProfile };
}

module.exports = { createCourierService };
