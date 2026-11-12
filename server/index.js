'use strict';
const { createApp } = require('./app');

async function main() {
  const { server, ctx, close } = createApp();
  const { config, svc } = ctx;

  const adminEmail = await svc.auth.ensureAdmin();
  if (adminEmail) console.log(`[setup] Administrador inicial criado: ${adminEmail}`);
  else if (!ctx.db.get("SELECT 1 AS x FROM users WHERE role = 'admin'")) {
    console.warn('[setup] Nenhum administrador cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o primeiro.');
  }

  server.listen(config.port, config.host, () => {
    console.log(`Sabor Express em ${config.appUrl} (${config.isProd ? 'produção' : 'desenvolvimento'})`);
    console.log(`Regra de entrega: até 15 km (estabelecimento → endereço do cliente). Geocodificador: ${ctx.geocoder.enabled ? config.geocoderProvider : 'desativado'}.`);
    if (!config.onlinePaymentEnabled) console.log('Pagamento online: não configurado (PAYMENT_WEBHOOK_SECRET). Disponível: pagamento na entrega.');
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} recebido, encerrando...`);
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
