'use strict';

class AppError extends Error {
  /**
   * @param {number} status  Código HTTP
   * @param {string} code    Código estável para o cliente (ex.: OUT_OF_RANGE)
   * @param {string} message Mensagem em português para o usuário
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
