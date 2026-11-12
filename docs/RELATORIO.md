# Relatório final — Sabor Express

## 1. Funcionalidades implementadas
- **Clientes:** cadastro, login, logout, recuperação de senha, perfil, endereços (com coordenadas), busca de restaurantes, cardápios com imagens, carrinho, checkout com cotação do servidor, acompanhamento (atualização a cada 10 s) e histórico, avaliações.
- **Restaurantes:** cadastro, perfil/localização, horários, produtos/seções/opções com upload de imagem, disponibilidade, painel de pedidos (kanban), atualização de status, histórico, avaliações.
- **Entregadores:** cadastro, disponibilidade, entregas elegíveis, aceite (concorrência resolvida), coleta/entrega, histórico.
- **Administração:** usuários, estabelecimentos, pedidos, permissões, configurações operacionais, indicadores.
- **Pedidos/pagamentos:** persistência, máquina de estados por papel, totais calculados no servidor, idempotência, cancelamentos, pagamento online confirmado só por webhook assinado (ou confirmação manual do admin).
- **Regra de 15 km** em listagem, promoções, cotação e checkout (backend autoritativo).
- Interface responsiva (celular/tablet/desktop), painéis separados por perfil, estados de carregamento/erro/vazio.

## 2. Corrigido / reconstruído
- Backend existente auditado e **mantido**; corrigido: corrida de entregadores respondia 404 → agora `409 ALREADY_TAKEN`.
- Frontend **reconstruído** do zero (SPA sem build).
- Limite de 60 km removido de todo o código; sobram apenas comentários/testes que documentam a revogação.
- Corrigido: modais que persistiam ao navegar; vários erros de sintaxe/UX encontrados no E2E.

## 3. Testes executados
- `npm test`: **90/90** passando (31 da regra de 15 km: 5 km, 14,9 km, 15 km exato, 15,1 km, sem coordenadas, falha do geocodificador, troca de endereço, burla pelo frontend; demais: autenticação, matriz de permissões, CSRF, preços, horários, fluxo completo, concorrência, cancelamento, webhook, upload, admin, privacidade).
- E2E em navegador real (Playwright/Chromium): **22/22** em três execuções seguidas com banco limpo; sem rolagem horizontal em 390×844.
- Modo produção verificado: recusa subir sem `JWT_SECRET`; HSTS e cookie `Secure` ativos.

## 4. Problemas conhecidos
- R1 GPS do aparelho como reserva de coordenadas (não verificável) — ver `DECISOES.md`.
- Distância em linha reta, não por rota.
- Instância única (SQLite, rate-limit em memória); atualização por polling.
- Não testado com geocodificador real (ambiente sem internet para ele) nem em celulares físicos.
- Os dois .docx originais ainda citam 60 km; precisam de atualização.

## 5. Dependências externas não configuradas
Gateway de pagamento real (só o webhook assinado existe), envio de e-mail (`MAIL_WEBHOOK_URL`), geocodificador de produção, disco persistente e backups, HTTPS/domínio, `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## 6. Executar / publicar
Veja `README.md`: `npm run seed && npm start` (dev); `Dockerfile` + `.env.example` (produção).

## 7. Estado real
Plataforma funcional ponta a ponta, testada localmente, **pronta para homologação**. Não está pronta para produção até configurar os itens da seção 5 e validar com geocodificador real. Dados de demonstração existem apenas pelo `seed` (bloqueado em produção).


---

# Atualização de 11/11/2026 — correções visuais, administrativas e identidade visual

Detalhes e causas em [`ATUALIZACAO.md`](ATUALIZACAO.md).

## Testes executados (de fato)
- `npm test`: **110/110** (os 90 anteriores continuam passando; +20 novos em `tests/activation.test.js`: permissões 401/403, autoproteção do admin, cliente/responsável/restaurante desativados, preservação de pedidos e histórico, pedidos em andamento não cancelados, 3 estados independentes, filtros, reativação, 15 km exato aceito / 15,1 km recusado).
- E2E em Chrome real: **31/31**, executado 3 vezes seguidas com banco limpo (antes 22). Novos passos: KPIs iguais, ativar/desativar pela interface, carrinho em 1440/1024/768/375 px.
- Auditoria visual automatizada: 15 telas × 5 larguras (320, 375, 768, 1024, 1440) e extras 720/960/1152/1280/1920: **nenhuma rolagem horizontal do documento**. Capturas inspecionadas manualmente em amostra.
- Modo produção: recusa subir sem `JWT_SECRET`; sobe com HSTS/CSP; `favicon.ico` servido.

## Limitações restantes
- Zoom do navegador foi **simulado** por largura de janela, não com zoom real.
- Sem celular físico, Safari/Firefox ou geocodificador real; testado apenas em Chrome.
- O `.docx` original ainda cita 60 km.
- O E2E depende de Playwright instalado na máquina (não vem no ZIP; o projeto em si não tem dependências).
- Painel de entregadores: só foi verificada a ausência de estouros; nada novo foi implementado.
- A logo foi usada como recebida (PNG raster 820 px). Não há versão vetorial/SVG; para impressão em grande formato convém um SVG.
