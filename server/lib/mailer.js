'use strict';

/**
 * Envio de e-mail transacional.
 *
 * Produção: defina MAIL_WEBHOOK_URL apontando para um provedor/automação que aceite
 *   POST JSON { from, to, subject, text }.
 * Sem configuração: em desenvolvimento a mensagem é escrita no console do servidor
 * (útil para testar a recuperação de senha); em produção o envio é registrado como não realizado.
 */
function createMailer(config) {
  if (config.mailWebhookUrl) {
    return {
      enabled: true,
      async send({ to, subject, text }) {
        const res = await fetch(config.mailWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.mailFrom, to, subject, text }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Provedor de e-mail respondeu ${res.status}`);
      },
    };
  }
  return {
    enabled: false,
    async send({ to, subject, text }) {
      if (!config.isProd) {
        console.log(`\n[e-mail simulado — desenvolvimento]\nPara: ${to}\nAssunto: ${subject}\n${text}\n`);
      } else {
        console.warn('[mailer] MAIL_WEBHOOK_URL não configurado: e-mail NÃO foi enviado.');
      }
    },
  };
}

module.exports = { createMailer };
