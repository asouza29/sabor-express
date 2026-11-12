# Sabor Express

Plataforma de pedidos e entregas de comida (clientes, restaurantes, entregadores e administração).
**Regra de entrega vigente: até 15 km** entre o estabelecimento e o endereço de entrega (o limite antigo de 60 km está revogado).

- **Backend:** Node.js 22.13+ (HTTP nativo, `node:sqlite`) — **zero dependências npm**.
- **Frontend:** SPA em JavaScript puro (ES modules), sem build. CSP estrita (`script-src 'self'`).
- **Banco:** SQLite (arquivo, modo WAL). Uploads de imagens em disco.

## Executar localmente

```bash
npm run seed            # dados de DEMONSTRAÇÃO (só em desenvolvimento; recusa rodar em produção)
npm start               # http://localhost:3000
```

Contas de demonstração (senha `demo1234`): `admin@`, `cliente@`, `forno@`, `brasa@`, `koen@`, `nonna@`, `acai@`,
`tempero@`, `pao@`, `doce@` (restaurantes) e `entregador@` — todas `@saborexpress.dev`.
O cliente de demonstração mora na Av. Paulista; o restaurante *Doce Vida* fica a ~17 km dele de propósito (fora do raio).

Sem internet o geocodificador público não responde: use `GEOCODER_PROVIDER=none`; o endereço então só ganha
coordenadas pelo botão **“Usar minha localização atual”** (GPS do navegador).

## Testes

```bash
npm test                # 110 testes de integração (backend real, banco em memória) — inclui a regra de 15 km e a ativação/desativação
npm run e2e             # opcional: navegador real (Playwright/Chromium), 31 passos, 4 perfis + celular
```

O E2E precisa do servidor rodando com o banco semeado (veja o cabeçalho de `tests/e2e/run.js`). Se o Playwright não achar o Chromium, defina `CHROME_PATH` com o caminho do Chrome instalado.

## Executar no Windows (PowerShell)

1. Instale o **Node.js 22.13 ou mais novo** (https://nodejs.org) e confira com `node --version`.
2. Extraia o ZIP, abra o PowerShell na pasta `sabor-express` e rode:

```powershell
npm run seed            # cria o banco de demonstração em .\data
$env:GEOCODER_PROVIDER="none"   # opcional: sem internet para o geocodificador
npm start               # abra http://localhost:3000
npm test                # roda os 110 testes
```

Para recomeçar do zero: pare o servidor (Ctrl+C) e rode `npm run seed -- --reset`.
O E2E (opcional) exige `npm i -D playwright` e o servidor rodando em outro terminal: `npm run e2e`.

## Identidade visual

A logo oficial está em `brand/sabor-logo-original.png`; os derivados (símbolo, ladrilho branco para fundos coloridos,
favicons PNG/ICO, ícone Apple) ficam em `public/assets/brand/`. Para regenerá-los: `npm i --no-save sharp` e `npm run brand`
(o `sharp` é usado só nessa ferramenta; o servidor continua sem dependências).

## Ativação e desativação (administração)

Três conceitos **diferentes**, mostrados em colunas separadas no painel:

| Conceito | Quem altera | Efeito |
|---|---|---|
| **Conta ativa/inativa** (cliente, responsável, entregador, admin) | Administrador | Conta inativa perde a sessão e não faz login (`403 ACCOUNT_DISABLED`). Nada é apagado. |
| **Restaurante ativo/inativo na plataforma** | Administrador | Some da vitrine e não recebe pedidos. Pedidos em andamento **não** são cancelados; o admin continua tratando-os em *Pedidos*. |
| **Aberto/fechado agora** | Calculado pelo horário de funcionamento e pela pausa do próprio restaurante | Não depende do administrador. |

O administrador não pode desativar a própria conta (`409 SELF_CHANGE`). Desativar pede confirmação; reativar não.

## Publicação

Veja `.env.example` e `Dockerfile`. Pontos essenciais:

1. `NODE_ENV=production` e `JWT_SECRET` (32+ caracteres) — o servidor **não sobe** sem ele.
2. `DATA_DIR` em **disco persistente** com backup (banco SQLite + `uploads/`). Uma única instância.
3. HTTPS na frente (proxy/CDN) com `TRUST_PROXY=true`.
4. `ADMIN_EMAIL`/`ADMIN_PASSWORD` para criar o primeiro administrador.
5. Geocodificador confiável (o Nominatim público é só para baixo volume), e-mail (`MAIL_WEBHOOK_URL`) e, se quiser pagamento online, `PAYMENT_WEBHOOK_SECRET` + um gateway que chame `/api/payments/webhook`.

## Estrutura

```
server/domain/      regras puras: delivery.js (15 km), geo.js, orderState.js, pricing.js, hours.js
server/services/    casos de uso (auth, catálogo, restaurante, pedidos, entregador, admin)
server/routes/      API REST    server/lib/  http, jwt, scrypt, multipart, rate-limit, geocoder, mailer
public/             SPA (js/views/*: site, auth, loja, entregas, admin)
brand/  logo original    tools/  geração de assets
tests/              testes de integração + e2e/    docs/  decisões e relatório
```

Documentação: [`docs/DECISOES.md`](docs/DECISOES.md) (regra de 15 km, riscos) e [`docs/RELATORIO.md`](docs/RELATORIO.md) (estado real do projeto).
