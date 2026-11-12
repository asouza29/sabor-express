'use strict';
/**
 * Teste ponta a ponta em navegador real (Chromium via Playwright). Opcional — não faz parte de `npm test`.
 *
 *   npm run seed -- --reset            (banco de demonstração)
 *   GEOCODER_PROVIDER=none npm start   (em outro terminal; sem internet o GPS do aparelho serve de reserva)
 *   BASE=http://localhost:3000 SHOTS=./shots node tests/e2e/run.js
 *
 * Requer `playwright` instalado globalmente ou no projeto. Usa as contas de demonstração do seed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const PW = 'demo1234';
const PAULISTA = { latitude: -23.5614, longitude: -46.6559 };
const FAR = { latitude: -23.9, longitude: -46.1 }; // ~70 km
fs.mkdirSync(SHOTS, { recursive: true });
// PNG 1x1 válido para o upload de imagem de produto
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pngPath = path.join(SHOTS, 'prato.png'); fs.writeFileSync(pngPath, PNG);

const results = []; const errors = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); }
  catch (e) { results.push([false, name, e.message.split('\n')[0]]); console.log('  ✗', name, '→', e.message.split('\n')[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'valor'}: esperado ${b}, obtido ${a}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condição falsa'); };

async function newPage(browser, { geo = PAULISTA, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, geolocation: geo, permissions: ['geolocation'], locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`CONSOLE ${m.text()}`); });
  return page;
}
async function login(page, email) {
  await page.goto(`${BASE}/#/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PW);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForFunction(() => !location.hash.startsWith('#/login'), null, { timeout: 8000 });
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {});
  let orderId; let orderCode;

  console.log('\n[1] Visitante e regra de 15 km na vitrine');
  const g = await newPage(browser);
  await step('home sem localização pede o local de entrega', async () => {
    await g.goto(`${BASE}/`); await g.waitForSelector('.hero');
    ok(await g.getByText('Escolher local de entrega').first().isVisible());
    await g.screenshot({ path: `${SHOTS}/01-home-sem-local.png` });
  });
  await step('GPS em SP mostra 7 restaurantes e oculta o de 17 km', async () => {
    await g.getByText('Escolher local de entrega').first().click();
    await g.getByText('Usar minha localização atual').click();
    await g.waitForSelector('.rest-card');
    eq(await g.locator('.rest-card').count(), 7, 'restaurantes');
    eq(await g.getByText('Doce Vida Confeitaria').count(), 0, 'Doce Vida visível');
    await g.waitForTimeout(500); await g.screenshot({ path: `${SHOTS}/02-home-desktop.png`, fullPage: true });
  });
  await step('busca por prato e filtro de categoria', async () => {
    await g.locator('.search.desktop input').fill('lasanha'); await g.keyboard.press('Enter');
    await g.waitForFunction(() => document.querySelectorAll('.rest-card').length === 1, null, { timeout: 8000 }).catch(() => {}); eq(await g.locator('.rest-card').count(), 1, 'busca lasanha');
    await g.goto(`${BASE}/#/`); await g.waitForSelector('.rest-card');
    await g.getByRole('button', { name: /Pizza/ }).click();
    await g.waitForFunction(() => document.querySelectorAll('.rest-card').length === 1, null, { timeout: 8000 }).catch(() => {});
    eq(await g.locator('.rest-card').count(), 1, 'categoria pizza');
  });
  await step('restaurante fora de 15 km: aviso e adição bloqueada', async () => {
    await g.goto(`${BASE}/#/r/8`); await g.waitForSelector('.notice.error');
    ok((await g.locator('.notice.error').innerText()).includes('não entrega'), 'mensagem de fora de área');
    ok((await g.locator('.notice.error').innerText()).includes('15 km'), 'cita 15 km');
    await g.locator('.prod').first().click();
    ok(await g.getByRole('button', { name: /Indisponível no momento/ }).isDisabled(), 'botão desabilitado');
    await g.screenshot({ path: `${SHOTS}/03-fora-do-raio.png` });
  });

  console.log('\n[2] Cliente: cadastro/login, carrinho, checkout');
  const c = await newPage(browser);
  await step('cadastro de novo cliente + endereço por GPS', async () => {
    await c.goto(`${BASE}/#/register`);
    await c.getByLabel('Nome completo').fill('Teste E2E'); await c.getByLabel('E-mail').fill(`e2e${Date.now()}@teste.com`);
    await c.getByLabel('Telefone com DDD').fill('11987654321'); await c.getByLabel(/Senha/).fill('senha-e2e-123');
    await c.getByRole('button', { name: 'Criar conta' }).click(); await c.waitForSelector('.hero');
    await c.goto(`${BASE}/#/account`); await c.getByRole('button', { name: /Novo/ }).click();
    await c.getByLabel('Rua / Avenida').fill('Rua Teste'); await c.getByLabel('Número').fill('10'); await c.getByLabel('Bairro').fill('Bela Vista'); await c.getByLabel('Cidade').fill('São Paulo');
    await c.getByRole('button', { name: /Usar minha localização atual/ }).click(); await c.waitForSelector('text=Localização atual capturada');
    await c.getByRole('button', { name: 'Salvar endereço' }).click();
    await c.waitForSelector('text=Localização confirmada');
  });
  const cust = await newPage(browser);
  await step('login cliente demo: localização vem do endereço salvo', async () => {
    await login(cust, 'cliente@saborexpress.dev'); await cust.waitForSelector('.rest-card');
    ok((await cust.locator('.loc-chip').innerText()).includes('Avenida Paulista'), 'chip de local');
  });
  await step('abre Açaí do Parque, adiciona 500 ml + granola ao carrinho', async () => {
    await cust.locator('.rest-card', { hasText: 'Açaí do Parque' }).click(); await cust.waitForSelector('.prod');
    await cust.locator('.prod', { hasText: 'Açaí 500 ml' }).click();
    await cust.getByText('Granola').click();
    await cust.getByRole('button', { name: /Adicionar ·/ }).click();
    await cust.waitForSelector('.toast');
    ok((await cust.locator('.site-header .count').innerText()) === '1', 'contador do carrinho');
    await cust.screenshot({ path: `${SHOTS}/04-restaurante.png` });
  });
  await step('checkout: cotação do servidor, distância e total corretos', async () => {
    await cust.getByRole('button', { name: 'Ir para o checkout' }).first().click();
    await cust.waitForSelector('text=Confirmar pedido'); await cust.waitForSelector('.chip.green');
    const t = (await cust.locator('.cart-panel').innerText()).replace(/\u00a0/g, ' ');
    ok(t.includes('R$ 21,90'), `subtotal 19,90+2,00 (obtido: ${t.replace(/\n/g, ' ')})`);
    ok(t.includes('R$ 26,80'), 'total com taxa de 4,90');
    await cust.screenshot({ path: `${SHOTS}/05-checkout.png` });
  });
  await step('confirma pedido (pix na entrega) e abre o acompanhamento', async () => {
    await cust.getByText('PIX na entrega').click();
    await cust.getByRole('button', { name: 'Confirmar pedido' }).click();
    await cust.waitForURL(/#\/orders\/\d+/); orderId = cust.url().split('/').pop();
    await cust.waitForSelector('.stepper'); orderCode = (await cust.locator('h1').innerText()).replace('Pedido ', '').trim();
    ok(/^SE-/.test(orderCode), 'código do pedido');
    await cust.screenshot({ path: `${SHOTS}/06-pedido-novo.png` });
  });

  console.log('\n[3] Restaurante: recebe, prepara, cadastra produto com imagem');
  const store = await newPage(browser);
  await step('painel mostra o pedido novo e aceita', async () => {
    await login(store, 'acai@saborexpress.dev'); await store.waitForSelector('.kanban');
    await store.locator('.kcard', { hasText: orderCode }).waitFor();
    await store.screenshot({ path: `${SHOTS}/07-loja-pedidos.png` });
    await store.locator('.kcard', { hasText: orderCode }).getByRole('button', { name: /Aceitar/ }).click();
    await store.locator('.kcol', { hasText: 'Em preparo' }).locator('.kcard', { hasText: orderCode }).waitFor();
  });
  await step('cadastra produto com upload de imagem e vê a imagem carregada', async () => {
    await store.goto(`${BASE}/#/loja/cardapio`); await store.getByRole('button', { name: /Novo produto/ }).click();
    await store.getByLabel('Nome do produto').fill('Açaí Teste E2E'); await store.getByLabel('Preço (R$)').fill('12,50');
    await store.locator('#pimg').setInputFiles(pngPath);
    await store.getByRole('button', { name: 'Cadastrar produto' }).click();
    await store.locator('.menu-row', { hasText: 'Açaí Teste E2E' }).first().waitFor(); eq(await store.locator('.menu-row', { hasText: 'Açaí Teste E2E' }).count(), 1, 'linhas do produto');
    const row = store.locator('.menu-row', { hasText: 'Açaí Teste E2E' });
    await store.waitForTimeout(500);
    ok(await row.locator('img').evaluate((i) => i.complete && i.naturalWidth > 0), 'imagem carregou');
    await store.screenshot({ path: `${SHOTS}/08-loja-cardapio.png` });
  });
  await step('marcar produto como esgotado some do cardápio público', async () => {
    const row = store.locator('.menu-row', { hasText: 'Açaí Teste E2E' });
    await row.locator('.switch').click(); await store.waitForSelector('.toast');
    await row.getByRole('button', { name: /Excluir/ }).click(); await store.locator('.modal footer').getByRole('button', { name: 'Excluir' }).click();
    await store.waitForSelector('text=Produto excluído.');
  });
  await step('marca o pedido como pronto', async () => {
    await store.goto(`${BASE}/#/loja`); await store.waitForSelector('.kanban');
    await store.locator('.kcard', { hasText: orderCode }).getByRole('button', { name: /pronto/ }).click();
    await store.locator('.kcol', { hasText: 'Prontos' }).locator('.kcard', { hasText: orderCode }).waitFor();
  });

  console.log('\n[4] Entregador');
  const cour = await newPage(browser);
  await step('vê a entrega disponível e aceita', async () => {
    await login(cour, 'entregador@saborexpress.dev'); await cour.waitForSelector('text=Entregas disponíveis');
    await cour.locator('article', { hasText: 'Açaí do Parque' }).first().waitFor();
    await cour.screenshot({ path: `${SHOTS}/09-entregador-disponiveis.png` });
    await cour.locator('article', { hasText: 'Açaí do Parque' }).first().getByRole('button', { name: 'Aceitar entrega' }).click();
    await cour.waitForURL(/entregas\/minhas/); await cour.locator('article', { hasText: orderCode }).waitFor();
    ok((await cour.locator('article', { hasText: orderCode }).innerText()).includes('Avenida Paulista'), 'endereço completo após aceitar');
  });
  await step('inicia e conclui a entrega', async () => {
    const card = cour.locator('article', { hasText: orderCode });
    await card.getByRole('button', { name: /iniciar entrega/ }).click();
    await card.getByRole('button', { name: /Confirmar entrega/ }).waitFor();
    await cour.screenshot({ path: `${SHOTS}/10-entregador-minhas.png` });
    await card.getByRole('button', { name: /Confirmar entrega/ }).click();
    await cour.waitForSelector('text=Nenhuma entrega em andamento', { timeout: 8000 }).catch(async () => { throw new Error('após confirmar: ' + (await cour.locator('main').innerText()).replace(/\n/g, ' ').slice(0, 300)); });
  });

  console.log('\n[5] Cliente acompanha, avalia');
  await step('pedido aparece como Entregue e aceita avaliação', async () => {
    await cust.goto(`${BASE}/#/orders/${orderId}`); await cust.waitForSelector('text=Como foi seu pedido?');
    ok((await cust.locator('.chip').first().innerText()).includes('Entregue'), 'status entregue');
    await cust.getByRole('radio', { name: '5 estrelas' }).click();
    await cust.getByRole('button', { name: 'Enviar avaliação' }).click(); await cust.waitForSelector('text=Sua avaliação');
    await cust.screenshot({ path: `${SHOTS}/11-pedido-entregue.png`, fullPage: true });
  });

  console.log('\n[6] Administração');
  const adm = await newPage(browser);
  await step('visão geral, pedidos, usuários, restaurantes e configurações', async () => {
    await login(adm, 'admin@saborexpress.dev'); await adm.waitForSelector('.kpis');
    await adm.screenshot({ path: `${SHOTS}/12-admin-visao-geral.png`, fullPage: true });
    await adm.goto(`${BASE}/#/admin/pedidos`); await adm.waitForSelector(`text=${orderCode}`);
    await adm.goto(`${BASE}/#/admin/usuarios`); await adm.waitForSelector('text=Mariana Souza');
    await adm.goto(`${BASE}/#/admin/restaurantes`); await adm.waitForSelector('text=Doce Vida Confeitaria');
    await adm.goto(`${BASE}/#/admin/config`); await adm.waitForSelector('text=Regra de entrega');
    ok((await adm.locator('body').innerText()).includes('15 km'), 'config mostra 15 km');
    await adm.screenshot({ path: `${SHOTS}/13-admin-config.png` });
  });
  await step('controle de acesso na interface: cliente não abre /admin', async () => {
    await cust.goto(`${BASE}/#/admin`); await cust.waitForTimeout(600);
    ok(!(await cust.locator('.kpis').count()), 'painel admin não deve renderizar'); ok(!cust.url().includes('#/admin'), 'redirecionado');
  });

  console.log('\n[6b] Atualização: KPIs padronizados, ativar/desativar pela interface, carrinho compacto');
  await step('KPIs do dashboard: 6 cards no mesmo padrão (classe, altura e largura)', async () => {
    await adm.goto(`${BASE}/#/admin`); await adm.waitForSelector('.kpis .kpi');
    const info = await adm.evaluate(() => [...document.querySelectorAll('.kpis .kpi')].map((e) => ({ card: e.classList.contains('card'), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width), ico: !!e.querySelector('.ico svg'), v: !!e.querySelector('.v'), l: !!e.querySelector('.l') })));
    eq(info.length, 6, 'quantidade de indicadores');
    ok(info.every((i) => i.card && i.ico && i.v && i.l), 'todos têm card, ícone, valor e descrição');
    ok(new Set(info.map((i) => i.h)).size === 1, `alturas iguais: ${info.map((i) => i.h)}`);
    ok(new Set(info.map((i) => i.w)).size === 1, `larguras iguais: ${info.map((i) => i.w)}`);
    await adm.screenshot({ path: `${SHOTS}/22-admin-kpis.png` });
  });
  await step('desativar cliente pela interface: confirmação, cancelar mantém ativo, confirmar desativa', async () => {
    await adm.goto(`${BASE}/#/admin/usuarios`); await adm.waitForSelector('text=Patrícia Alves');
    const row = adm.locator('tr', { hasText: 'Patrícia Alves' });
    const sw = row.locator('input[type=checkbox]');
    ok(await sw.isChecked(), 'começa ativa');
    await sw.click(); await adm.waitForSelector('.modal');
    ok((await adm.locator('.modal').innerText()).includes('Desativar conta?'), 'pede confirmação');
    await adm.getByRole('button', { name: 'Voltar' }).click(); await adm.waitForTimeout(300);
    ok(await sw.isChecked(), 'cancelar mantém a conta ativa');
    await sw.click(); await adm.waitForSelector('.modal'); await adm.getByRole('button', { name: 'Desativar', exact: true }).click();
    await adm.waitForSelector('tr:has-text("Patrícia Alves") .chip:has-text("Inativa")');
    ok(!(await adm.locator('tr', { hasText: 'Patrícia Alves' }).locator('input[type=checkbox]').isChecked()), 'interruptor desligado');
    await adm.screenshot({ path: `${SHOTS}/23-admin-usuario-inativo.png` });
  });
  await step('conta desativada é recusada no login com mensagem clara; reativar restaura o acesso', async () => {
    const pc = await newPage(browser);
    await pc.goto(`${BASE}/#/login`); await pc.getByLabel('E-mail').fill('patricia@saborexpress.dev'); await pc.getByLabel('Senha').fill(PW);
    await pc.getByRole('button', { name: 'Entrar', exact: true }).click(); await pc.waitForSelector('text=desativada');
    await adm.locator('tr', { hasText: 'Patrícia Alves' }).locator('input[type=checkbox]').click(); // reativar não pede confirmação
    await adm.waitForSelector('tr:has-text("Patrícia Alves") .chip:has-text("Ativa")');
    await pc.getByRole('button', { name: 'Entrar', exact: true }).click(); await pc.waitForFunction(() => !location.hash.startsWith('#/login'), null, { timeout: 8000 });
  });
  await step('o administrador não tem interruptor na própria conta', async () => {
    const own = adm.locator('tr', { hasText: 'admin@saborexpress.dev' });
    eq(await own.locator('input[type=checkbox]').count(), 0, 'sem interruptor'); ok((await own.innerText()).includes('você'), 'marcado como "você"');
  });
  await step('desativar restaurante: aviso de que pedidos não são apagados; some da vitrine; reativar volta', async () => {
    await adm.goto(`${BASE}/#/admin/restaurantes`); await adm.waitForSelector('text=Burger Brasa');
    const row = adm.locator('tr', { hasText: 'Burger Brasa' });
    ok((await row.innerText()).includes('Aberto agora') || (await row.innerText()).includes('Fechado agora'), 'coluna de funcionamento separada');
    await row.locator('input[type=checkbox]').click(); await adm.waitForSelector('.modal');
    ok((await adm.locator('.modal').innerText()).includes('preservados'), 'explica a preservação de dados');
    await adm.getByRole('button', { name: 'Desativar', exact: true }).click();
    await adm.waitForSelector('tr:has-text("Burger Brasa") .chip:has-text("Inativo")');
    const vis = await newPage(browser);
    await vis.goto(`${BASE}/#/`); await vis.getByText('Escolher local de entrega').first().click(); await vis.getByText('Usar minha localização atual').click(); await vis.waitForSelector('.rest-card');
    eq(await vis.getByText('Burger Brasa').count(), 0, 'Burger Brasa some da vitrine');
    await adm.locator('tr', { hasText: 'Burger Brasa' }).locator('input[type=checkbox]').click();
    await adm.waitForSelector('tr:has-text("Burger Brasa") .chip:has-text("Ativo")');
    await vis.reload(); await vis.waitForSelector('.rest-card'); ok((await vis.getByText('Burger Brasa').count()) > 0, 'volta à vitrine após reativar');
  });
  for (const [w, hgt] of [[1440, 900], [1024, 768], [768, 1024], [375, 800]]) {
    await step(`carrinho compacto sem rolagem horizontal em ${w} px (painel lateral e gaveta)`, async () => {
      const cp = await newPage(browser, { viewport: { width: w, height: hgt } });
      await login(cp, 'cliente@saborexpress.dev'); await cp.goto(`${BASE}/#/`); await cp.waitForSelector('.rest-card');
      await cp.locator('.rest-card', { hasText: 'Burger Brasa' }).click(); await cp.waitForSelector('.prod');
      for (const name of ['Duplo Cheddar', 'Batata Frita Rústica']) {
        await cp.locator('.prod', { hasText: name }).click();
        await cp.getByRole('button', { name: /Adicionar/ }).click(); await cp.waitForTimeout(250);
      }
      ok(await noOverflow(cp), 'página sem rolagem horizontal');
      if (w > 1020) {
        const imgH = await cp.locator('.cart-panel .cl-thumb').first().evaluate((e) => e.getBoundingClientRect().height);
        ok(imgH <= 80, `miniatura limitada (${imgH}px)`);
        ok(await cp.locator('.cart-panel').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'painel sem estouro');
      }
      await cp.locator('[aria-label^="Carrinho"]').first().click().catch(async () => { await cp.getByRole('link', { name: /Carrinho/ }).click(); });
      await cp.waitForSelector('.drawer .cart-line');
      const m = await cp.evaluate(() => { const d = document.querySelector('.drawer .dbody'); const t = document.querySelector('.drawer .cl-thumb').getBoundingClientRect(); const lines = [...document.querySelectorAll('.drawer .cart-line')]; return { sw: d.scrollWidth, cw: d.clientWidth, th: Math.round(t.height), outside: lines.some((l) => [...l.querySelectorAll('*')].some((e) => e.getBoundingClientRect().right > d.getBoundingClientRect().right + 1)), n: lines.length }; });
      ok(m.sw <= m.cw + 1, `gaveta sem rolagem horizontal (${m.sw}>${m.cw})`); ok(m.th <= 80, `miniatura da gaveta ${m.th}px`); ok(!m.outside, 'nada ultrapassa a gaveta'); eq(m.n, 2, 'linhas do carrinho');
      ok(await cp.locator('.drawer footer button:has-text("Ir para o checkout")').isVisible(), 'botão de checkout visível');
      await cp.screenshot({ path: `${SHOTS}/24-carrinho-${w}.png` });
      // quantidade e remoção (sem tocar na lógica de preços)
      const before = await cp.locator('.drawer footer .totals strong').innerText();
      await cp.locator('.drawer').getByRole('button', { name: 'Aumentar Duplo Cheddar' }).click(); await cp.waitForTimeout(200);
      ok((await cp.locator('.drawer footer .totals strong').innerText()) !== before, 'subtotal muda ao aumentar a quantidade');
      await cp.locator('.drawer').getByRole('button', { name: 'Remover Batata Frita Rústica' }).click(); await cp.waitForTimeout(200);
      eq(await cp.locator('.drawer .cart-line').count(), 1, 'linha removida');
    });
  }

  console.log('\n[7] Checkout com endereço fora de 15 km (GPS a ~70 km) é recusado pelo servidor');
  const far = await newPage(browser, { geo: FAR });
  await step('endereço longe + restaurante próximo → mensagem de 15 km e botão desabilitado', async () => {
    await login(far, 'joao@saborexpress.dev');
    await far.goto(`${BASE}/#/account`); await far.getByRole('button', { name: /Novo/ }).click();
    await far.getByLabel('Rua / Avenida').fill('Estrada Longínqua'); await far.getByLabel('Número').fill('1'); await far.getByLabel('Bairro').fill('Longe'); await far.getByLabel('Cidade').fill('Santos');
    await far.getByRole('button', { name: /Usar minha localização atual/ }).click(); await far.waitForSelector('text=Localização atual capturada');
    await far.getByRole('button', { name: 'Salvar endereço' }).click(); await far.waitForSelector('text=Localização confirmada >> nth=1');
    // coloca item no carrinho (restaurante pela URL com o local padrão do cliente) e força o endereço longe no checkout
    await far.goto(`${BASE}/#/`); await far.waitForSelector('.rest-card');
    await far.locator('.rest-card', { hasText: 'Açaí do Parque' }).click(); await far.waitForSelector('.prod');
    await far.locator('.prod', { hasText: 'Açaí 300 ml' }).click(); await far.getByRole('button', { name: /Adicionar ·/ }).click(); await far.waitForSelector('.toast');
    await far.goto(`${BASE}/#/checkout`); await far.waitForSelector('text=Confirmar pedido');
    await far.waitForSelector('.notice.error, .chip.green');
    if (await far.locator('.chip.green').count()) { // abriu com o endereço da Paulista: troca para o longe
      await far.getByRole('button', { name: 'Trocar' }).click(); await far.getByText('Estrada Longínqua').click();
      await far.waitForSelector('.notice.error');
    }
    const txt = await far.locator('.notice.error').innerText();
    ok(txt.includes('15 km'), `mensagem cita 15 km (obtido: ${txt})`);
    ok(await far.getByRole('button', { name: 'Confirmar pedido' }).isDisabled(), 'botão confirmar desabilitado');
    await far.screenshot({ path: `${SHOTS}/14-checkout-fora-do-raio.png` });
  });

  console.log('\n[8] Responsividade (celular 390×844)');
  const mob = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await step('home, restaurante, checkout, painéis sem rolagem horizontal', async () => {
    await login(mob, 'cliente@saborexpress.dev'); await mob.waitForSelector('.rest-card');
    ok(await noOverflow(mob), 'home sem overflow'); await mob.screenshot({ path: `${SHOTS}/15-mobile-home.png` });
    ok(await mob.locator('.bottom-nav').isVisible(), 'navegação inferior');
    await mob.locator('.rest-card', { hasText: 'Pão & Prosa' }).click(); await mob.waitForSelector('.prod');
    ok(await noOverflow(mob), 'restaurante sem overflow'); await mob.screenshot({ path: `${SHOTS}/16-mobile-restaurante.png` });
    await mob.locator('.prod').first().click(); await mob.screenshot({ path: `${SHOTS}/17-mobile-produto.png` });
    ok(await noOverflow(mob), 'modal sem overflow');
    await mob.getByRole('button', { name: /Adicionar ·/ }).click(); await mob.waitForSelector('.sticky-cta:not(.hide)');
    await mob.goto(`${BASE}/#/checkout`); await mob.waitForSelector('text=Confirmar pedido'); ok(await noOverflow(mob), 'checkout sem overflow');
    await mob.screenshot({ path: `${SHOTS}/18-mobile-checkout.png` });
    await mob.goto(`${BASE}/#/orders`); await mob.waitForSelector('.order-card'); ok(await noOverflow(mob), 'pedidos sem overflow');
  });
  const mobStore = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await step('painéis do restaurante, entregador e admin no celular', async () => {
    await login(mobStore, 'acai@saborexpress.dev'); await mobStore.waitForSelector('.panel-tabs a');
    ok(await noOverflow(mobStore), 'loja pedidos'); await mobStore.screenshot({ path: `${SHOTS}/19-mobile-loja.png` });
    await mobStore.goto(`${BASE}/#/loja/cardapio`); await mobStore.waitForSelector('.menu-row'); ok(await noOverflow(mobStore), 'loja cardápio');
    await mobStore.goto(`${BASE}/#/loja/config`); await mobStore.waitForSelector('.hours-row'); ok(await noOverflow(mobStore), 'loja config');
    const mc = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await login(mc, 'entregador@saborexpress.dev'); await mc.waitForSelector('.avail-toggle'); ok(await noOverflow(mc), 'entregador');
    await mc.screenshot({ path: `${SHOTS}/20-mobile-entregador.png` });
    const ma = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await login(ma, 'admin@saborexpress.dev'); await ma.waitForSelector('.kpis'); ok(await noOverflow(ma), 'admin'); await ma.screenshot({ path: `${SHOTS}/21-mobile-admin.png` });
  });

  console.log('\n[9] Erros de console/JS durante toda a execução');
  await step('nenhum erro de JavaScript ou de console', async () => { ok(errors.length === 0, errors.slice(0, 3).join(' | ')); });

  await browser.close();
  const failed = results.filter((r) => !r[0]);
  console.log(`\nResultado: ${results.length - failed.length}/${results.length} passos OK`);
  fs.writeFileSync(path.join(SHOTS, 'resultado.json'), JSON.stringify({ results, errors }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
