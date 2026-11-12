'use strict';
/**
 * Dados de DEMONSTRAÇÃO para desenvolvimento local. Não é usado em produção.
 *
 *   npm run seed              cria os dados se o banco estiver vazio
 *   npm run seed -- --reset   APAGA o arquivo do banco e recria tudo (destrutivo)
 *
 * Todos os estabelecimentos, telefones e avaliações são fictícios.
 * Coordenadas: bairros reais de São Paulo/SP, fixadas à mão (sem geocodificador).
 * Um estabelecimento (Doce Vida) fica propositalmente a ~16 km do cliente de demonstração
 * para exibir a regra de 15 km em ação.
 */
const fs = require('node:fs');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { hashPassword } = require('./lib/password');
const { haversineMeters } = require('./domain/geo');

const args = new Set(process.argv.slice(2));
const config = loadConfig();

if (config.isProd && !args.has('--force')) {
  console.error('Recusado: seed é apenas para desenvolvimento (NODE_ENV=production). Use --force se tiver certeza.');
  process.exit(1);
}
if (args.has('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
  console.log('Banco anterior removido (--reset).');
}

const db = openDb(config.dbFile);
if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.error('O banco já tem usuários. Nada foi alterado. Use "npm run seed -- --reset" para recriar (apaga os dados).');
  process.exit(1);
}

const DEMO_PASSWORD = 'demo1234';
const CUSTOMER_HOME = { street: 'Avenida Paulista', number: '1578', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', zip: '01310200', lat: -23.5614, lng: -46.6559 };

const HOURS_STD = ['11:00', '23:30'];
const stores = [
  {
    key: 'forno', owner: 'Rafael Moretti', email: 'forno@saborexpress.dev', name: 'Forno a Lenha Paulista', cat: 'pizza',
    desc: 'Pizzas artesanais de massa fermentada por 48 horas, assadas em forno a lenha.',
    phone: '11932100001', street: 'Rua Augusta', number: '1200', neighborhood: 'Consolação', zip: '01304001', lat: -23.5538, lng: -46.6603,
    fee: 590, min: 3000, prep: 40, hours: HOURS_STD,
    sections: {
      'Pizzas salgadas': [
        ['Margherita', 'Molho de tomate italiano, muçarela de búfala, manjericão fresco e azeite.', 4290, 3690, 'pizza', [['Borda recheada', 800], ['Queijo extra', 600]]],
        ['Calabresa Acebolada', 'Calabresa artesanal, cebola roxa, azeitonas e orégano.', 4590, null, 'pizza', [['Borda recheada', 800], ['Queijo extra', 600]]],
        ['Quatro Queijos', 'Muçarela, provolone, gorgonzola e parmesão.', 5190, null, 'pizza', [['Borda recheada', 800]]],
      ],
      'Pizzas doces': [['Chocolate com Morango', 'Chocolate ao leite derretido e morangos frescos.', 4890, null, 'cake', []]],
      Bebidas: [
        ['Suco de Laranja 500 ml', 'Espremido na hora, sem açúcar.', 900, null, 'drink', []],
        ['Refrigerante lata', 'Lata 350 ml, gelada.', 700, null, 'drink', []],
      ],
    },
  },
  {
    key: 'brasa', owner: 'Bianca Teixeira', email: 'brasa@saborexpress.dev', name: 'Burger Brasa', cat: 'lanches',
    desc: 'Hambúrgueres de blend bovino grelhado na brasa, pão de brioche e molhos da casa.',
    phone: '11932100002', street: 'Rua dos Pinheiros', number: '640', neighborhood: 'Pinheiros', zip: '05422001', lat: -23.5667, lng: -46.6916,
    fee: 790, min: 2500, prep: 30, hours: HOURS_STD,
    sections: {
      Hambúrgueres: [
        ['Brasa Clássico', 'Blend 160 g, queijo prato, alface, tomate e molho da casa.', 3290, null, 'burger', [['Bacon crocante', 500], ['Ovo', 300], ['Queijo extra', 400]]],
        ['Duplo Cheddar', 'Dois blends de 120 g, cheddar cremoso e cebola caramelizada.', 4290, 3790, 'burger', [['Bacon crocante', 500]]],
      ],
      Acompanhamentos: [['Batata Frita Rústica', 'Porção individual com páprica.', 1890, null, 'fries', [['Cheddar e bacon', 700]]]],
      Bebidas: [
        ['Milkshake de Chocolate', '400 ml, com calda e chantilly.', 1990, null, 'drink', []],
        ['Refrigerante lata', 'Lata 350 ml, gelada.', 700, null, 'drink', []],
      ],
    },
  },
  {
    key: 'koen', owner: 'Hiroshi Tanaka', email: 'koen@saborexpress.dev', name: 'Sushi Kōen', cat: 'japonesa',
    desc: 'Culinária japonesa tradicional com peixes selecionados diariamente.',
    phone: '11932100003', street: 'Rua da Glória', number: '300', neighborhood: 'Liberdade', zip: '01510000', lat: -23.5586, lng: -46.6355,
    fee: 690, min: 4000, prep: 45, hours: ['11:30', '22:30'],
    sections: {
      Combinados: [
        ['Combinado 12 peças', '4 uramakis, 4 hossomakis e 4 niguiris variados.', 5490, null, 'sushi', [['Shoyu extra', 0], ['Hashi extra', 0]]],
        ['Combinado 24 peças', 'Seleção do chef para duas pessoas.', 9890, 8990, 'sushi', []],
      ],
      Entradas: [['Salada Kani', 'Kani, pepino, manga e gergelim.', 2490, null, 'salad', []]],
      Bebidas: [['Chá gelado de hortelã', '500 ml.', 890, null, 'drink', []]],
    },
  },
  {
    key: 'nonna', owner: 'Giovanna Rossi', email: 'nonna@saborexpress.dev', name: 'Cantina da Nonna', cat: 'massas',
    desc: 'Massas frescas feitas todos os dias, com molhos de receita de família.',
    phone: '11932100004', street: 'Rua da Mooca', number: '2100', neighborhood: 'Mooca', zip: '03104002', lat: -23.5586, lng: -46.5990,
    fee: 890, min: 3500, prep: 35, hours: HOURS_STD,
    sections: {
      Massas: [
        ['Espaguete à Bolonhesa', 'Molho de carne cozido por 4 horas.', 3890, null, 'pasta', [['Parmesão extra', 400]]],
        ['Fettuccine Alfredo', 'Creme de leite fresco, manteiga e parmesão.', 4290, null, 'pasta', [['Parmesão extra', 400], ['Frango grelhado', 900]]],
        ['Lasanha à Bolonhesa', 'Camadas de massa fresca, molho e queijos gratinados.', 4490, 3990, 'pasta', []],
      ],
      Sobremesas: [['Tiramisù', 'Receita clássica, porção individual.', 2290, null, 'cake', []]],
    },
  },
  {
    key: 'acai', owner: 'Camila Duarte', email: 'acai@saborexpress.dev', name: 'Açaí do Parque', cat: 'acai',
    desc: 'Açaí cremoso batido na hora, com acompanhamentos à sua escolha.',
    phone: '11932100005', street: 'Avenida Pedro Álvares Cabral', number: '45', neighborhood: 'Vila Mariana', zip: '04094050', lat: -23.5890, lng: -46.6590,
    fee: 490, min: 1500, prep: 15, hours: ['07:00', '23:00'],
    sections: {
      Açaís: [
        ['Açaí 300 ml', 'Açaí tradicional batido com banana.', 1690, null, 'acai', [['Granola', 200], ['Leite ninho', 300], ['Banana', 200], ['Morango', 400]]],
        ['Açaí 500 ml', 'O favorito da casa.', 2290, 1990, 'acai', [['Granola', 200], ['Leite ninho', 300], ['Banana', 200], ['Morango', 400]]],
        ['Açaí 700 ml', 'Para dividir (ou não).', 2890, null, 'acai', [['Granola', 200], ['Leite ninho', 300], ['Morango', 400]]],
      ],
      Bebidas: [['Suco de laranja 500 ml', 'Natural, sem açúcar.', 1090, null, 'drink', []]],
      Frutas: [['Salada de frutas', 'Frutas da estação, porção individual.', 1590, null, 'salad', []]],
    },
  },
  {
    key: 'tempero', owner: 'Dona Lúcia Ferreira', email: 'tempero@saborexpress.dev', name: 'Tempero Brasileiro', cat: 'brasileira',
    desc: 'Comida caseira de verdade: marmitas fresquinhas todos os dias.',
    phone: '11932100006', street: 'Rua Voluntários da Pátria', number: '1500', neighborhood: 'Santana', zip: '02011000', lat: -23.5014, lng: -46.6258,
    fee: 790, min: 2000, prep: 30, hours: ['06:00', '16:00'],
    sections: {
      'Pratos do dia': [
        ['Frango grelhado', 'Arroz, feijão, filé de frango grelhado, farofa e salada.', 2890, null, 'marmita', [['Ovo frito', 300], ['Batata frita', 600]]],
        ['Bife acebolado', 'Arroz, feijão, bife acebolado, farofa e salada.', 3290, 2990, 'marmita', [['Ovo frito', 300]]],
        ['Feijoada completa', 'Feijoada com carnes selecionadas, arroz, couve, farofa e laranja.', 3990, null, 'marmita', []],
      ],
      Bebidas: [
        ['Suco natural 500 ml', 'Sabor do dia.', 890, null, 'drink', []],
        ['Café coado', 'Pequeno, 150 ml.', 590, null, 'coffee', []],
      ],
    },
  },
  {
    key: 'pao', owner: 'Seu Antônio Pereira', email: 'pao@saborexpress.dev', name: 'Pão & Prosa Padaria', cat: 'padaria',
    desc: 'Padaria de bairro: pães quentinhos, salgados e café passado na hora.',
    phone: '11932100007', street: 'Rua Haddock Lobo', number: '800', neighborhood: 'Cerqueira César', zip: '01414001', lat: -23.5575, lng: -46.6680,
    fee: 490, min: 1500, prep: 20, hours: ['05:30', '22:00'],
    sections: {
      'Pães e salgados': [
        ['Croissant de manteiga', 'Folhado, assado na hora.', 890, null, 'croissant', [['Recheio de presunto e queijo', 500]]],
        ['Pão na chapa', 'Pão francês na chapa com manteiga.', 790, null, 'croissant', []],
      ],
      'Doces e bebidas': [
        ['Bolo de cenoura (fatia)', 'Com cobertura de chocolate.', 1090, null, 'cake', []],
        ['Café com leite', 'Médio, 300 ml.', 690, null, 'coffee', [['Chantilly', 200]]],
        ['Suco de laranja 400 ml', 'Natural.', 990, null, 'drink', []],
      ],
    },
  },
  {
    key: 'doce', owner: 'Marta Vilela', email: 'doce@saborexpress.dev', name: 'Doce Vida Confeitaria', cat: 'doces',
    desc: 'Bolos, tortas e brigadeiros gourmet. (Fora do raio de 15 km do cliente de demonstração.)',
    phone: '11932100008', street: 'Rua Marechal Deodoro', number: '900', neighborhood: 'Centro', city: 'São Bernardo do Campo', zip: '09710000', lat: -23.6914, lng: -46.5646,
    fee: 990, min: 2500, prep: 30, hours: HOURS_STD,
    sections: {
      Bolos: [['Bolo de chocolate (fatia)', 'Massa úmida com ganache.', 1490, null, 'cake', []]],
      Doces: [['Caixa de brigadeiros (12)', 'Sabores sortidos.', 3290, null, 'brigadeiro', []]],
    },
  },
];

const customers = [
  { name: 'Mariana Souza', email: 'cliente@saborexpress.dev', phone: '11991230001' },
  { name: 'João Lima', email: 'joao@saborexpress.dev', phone: '11991230002' },
  { name: 'Patrícia Alves', email: 'patricia@saborexpress.dev', phone: '11991230003' },
];
const couriers = [
  { name: 'Carlos Entregador', email: 'entregador@saborexpress.dev', phone: '11990000001', vehicle: 'moto', available: 1 },
  { name: 'Bruna Pedal', email: 'bruna@saborexpress.dev', phone: '11990000002', vehicle: 'bicicleta', available: 0 },
];
const reviewTexts = [
  [5, 'Chegou quentinho e bem antes do previsto. Recomendo!'], [5, 'Comida excelente, embalagem caprichada.'],
  [4, 'Muito bom, só demorou um pouco mais que o estimado.'], [5, 'Melhor da região, já virei cliente.'],
  [4, 'Gostoso e bem servido.'], [3, 'Bom, mas veio morno.'], [5, 'Perfeito!'],
];

(async () => {
  const hash = await hashPassword(DEMO_PASSWORD, { N: config.scryptN });
  const ts = () => new Date().toISOString();
  const cats = Object.fromEntries(db.all('SELECT id, slug FROM food_categories').map((c) => [c.slug, c.id]));
  const addUser = (role, name, email, phone, pw = hash) =>
    db.run('INSERT INTO users (role, name, email, phone, password_hash) VALUES (?,?,?,?,?)', role, name, email, phone, pw).id;

  db.tx(() => {
    // Administrador de demonstração (em produção use ADMIN_EMAIL/ADMIN_PASSWORD).
    addUser('admin', 'Administrador Demo', 'admin@saborexpress.dev', null);

    const customerIds = customers.map((c) => {
      const id = addUser('cliente', c.name, c.email, c.phone);
      db.run(`INSERT INTO addresses (user_id, label, street, number, complement, neighborhood, city, state, zip, lat, lng, coords_source, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, 'Casa', CUSTOMER_HOME.street, CUSTOMER_HOME.number, 'Apto 42', CUSTOMER_HOME.neighborhood, CUSTOMER_HOME.city, CUSTOMER_HOME.state,
        CUSTOMER_HOME.zip, CUSTOMER_HOME.lat, CUSTOMER_HOME.lng, 'geocoder', ts());
      return id;
    });
    couriers.forEach((c) => {
      const id = addUser('entregador', c.name, c.email, c.phone);
      db.run('INSERT INTO courier_profiles (user_id, vehicle, available) VALUES (?,?,?)', id, c.vehicle, c.available);
    });

    let reviewIdx = 0;
    let demoOrderSeq = 0;
    for (const s of stores) {
      const ownerId = addUser('estabelecimento', s.owner, s.email, s.phone);
      const r = db.run(
        `INSERT INTO restaurants (owner_id, name, description, category_id, phone, street, number, neighborhood, city, state, zip,
           lat, lng, coords_source, delivery_fee_cents, min_order_cents, prep_time_min, logo_path, cover_path, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ownerId, s.name, s.desc, cats[s.cat], s.phone, s.street, s.number, s.neighborhood, s.city || 'São Paulo', 'SP', s.zip,
        s.lat, s.lng, 'geocoder', s.fee, s.min, s.prep, `demo/logo-${s.key}.svg`, `demo/cover-${s.key}.svg`, ts(),
      );
      for (let d = 0; d < 7; d++) db.run('INSERT INTO opening_hours (restaurant_id, weekday, opens, closes) VALUES (?,?,?,?)', r.id, d, s.hours[0], s.hours[1]);

      const productIds = [];
      let pos = 0;
      for (const [sectionName, items] of Object.entries(s.sections)) {
        const sec = db.run('INSERT INTO menu_sections (restaurant_id, name, position) VALUES (?,?,?)', r.id, sectionName, ++pos);
        for (const [name, desc, price, promo, img, opts] of items) {
          const p = db.run(
            `INSERT INTO products (restaurant_id, section_id, name, description, price_cents, promo_price_cents, image_path, updated_at)
             VALUES (?,?,?,?,?,?,?,?)`, r.id, sec.id, name, desc, price, promo, `demo/dish-${img}.svg`, ts());
          opts.forEach(([on, op]) => db.run('INSERT INTO product_options (product_id, name, price_cents) VALUES (?,?,?)', p.id, on, op));
          productIds.push({ id: p.id, name, price: promo ?? price });
        }
      }

      // Pedidos já entregues (histórico) + avaliações, para as notas aparecerem na vitrine.
      const nReviews = 2 + (reviewIdx % 2);
      for (let i = 0; i < nReviews; i++) {
        const cust = customerIds[(reviewIdx + i) % customerIds.length];
        const prod = productIds[i % productIds.length];
        const [rating, comment] = reviewTexts[(reviewIdx + i) % reviewTexts.length];
        const when = new Date(Date.now() - (3 + reviewIdx * 2 + i) * 24 * 3600 * 1000).toISOString();
        const total = prod.price + s.fee;
        const code = `SE-D${String(++demoOrderSeq).padStart(5, '0')}`; // prefixo D = demonstração
        const dist = Math.round(haversineMeters({ lat: s.lat, lng: s.lng }, CUSTOMER_HOME));
        const o = db.run(
          `INSERT INTO orders (code, customer_id, restaurant_id, status, subtotal_cents, delivery_fee_cents, total_cents, payment_method,
             customer_name, customer_phone, addr_label, addr_street, addr_number, addr_neighborhood, addr_city, addr_state, addr_zip,
             addr_lat, addr_lng, addr_coords_source, distance_m, created_at, updated_at, delivered_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          code, cust, r.id, 'entregue', prod.price, s.fee, total, 'pix_entrega',
          customers[customerIds.indexOf(cust)].name, customers[customerIds.indexOf(cust)].phone, 'Casa', CUSTOMER_HOME.street, CUSTOMER_HOME.number,
          CUSTOMER_HOME.neighborhood, CUSTOMER_HOME.city, CUSTOMER_HOME.state, CUSTOMER_HOME.zip, CUSTOMER_HOME.lat, CUSTOMER_HOME.lng, 'geocoder',
          dist, when, when, when,
        );
        db.run('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?)', o.id, prod.id, prod.name, prod.price, 1, prod.price);
        db.run('INSERT INTO payments (order_id, method, status, amount_cents, paid_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', o.id, 'pix_entrega', 'pago', total, when, when, when);
        db.run('INSERT INTO order_events (order_id, status, actor_role, note, created_at) VALUES (?,?,?,?,?)', o.id, 'novo', 'cliente', 'Pedido criado', when);
        db.run('INSERT INTO order_events (order_id, status, actor_role, created_at) VALUES (?,?,?,?)', o.id, 'entregue', 'entregador', when);
        db.run('INSERT INTO reviews (order_id, customer_id, restaurant_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)', o.id, cust, r.id, rating, comment, when);
      }
      reviewIdx += 1;
      const km = (haversineMeters({ lat: s.lat, lng: s.lng }, CUSTOMER_HOME) / 1000).toFixed(1).replace('.', ',');
      console.log(`  ✓ ${s.name.padEnd(26)} ${km.padStart(5)} km  ${Number(km.replace(',', '.')) > 15 ? '(fora do raio de 15 km)' : ''}`);
    }
  });

  console.log(`
Dados de demonstração criados em ${config.dbFile}
Senha de TODAS as contas de demonstração: ${DEMO_PASSWORD}
  admin        admin@saborexpress.dev
  cliente      cliente@saborexpress.dev  (endereço: ${CUSTOMER_HOME.street}, ${CUSTOMER_HOME.number} — ${CUSTOMER_HOME.neighborhood})
  restaurante  forno@ | brasa@ | koen@ | nonna@ | acai@ | tempero@ | pao@ | doce@  saborexpress.dev
  entregador   entregador@saborexpress.dev (disponível)  |  bruna@saborexpress.dev
`);
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
