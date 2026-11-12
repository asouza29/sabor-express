# Atualização — correções visuais, administrativas e identidade visual

## Causa do problema dos interruptores "Ativo"
O backend (rotas `PATCH /api/admin/users/:id` e `/api/admin/restaurants/:id`, persistência e bloqueio de login/pedidos) **já funcionava**
e foi confirmado por chamadas reais à API. O defeito era de interface: o `.switch` é um `<span>` inline (sem `display`), então largura e altura eram ignoradas, a trilha colapsava e
só a bolinha branca aparecia (como nas suas capturas); também faltavam rótulo de estado e confirmação. Além disso, não havia confirmação,
nem chip de estado, nem diferenciação entre conta inativa, restaurante inativo e restaurante fechado.

## Corrigido
- Logo oficial no cabeçalho, autenticação, painéis e favicon (ICO + PNG + Apple); ladrilho branco para fundos coloridos.
- Carrinho (painel e gaveta): miniatura 64 px, nome/quantidade/preço/remover alinhados, sem rolagem horizontal; rolagem vertical só na lista; checkout sempre visível. Lógica de preços intacta.
- Sobreposições: `.header-slot {display: contents}` (o cabeçalho sticky não é mais limitado pelo contêiner), grid do restaurante com `minmax(0, …)`, busca do cabeçalho em 2ª linha até 1020 px, avisos (toast) fora do carrinho, padding lateral do `.page` não sobrescreve o contêiner.
- Dashboard: 6 indicadores no mesmo componente (card, ícone, número, descrição), grid 3×2 (2 colunas no celular). Causa: `h('div.card.kpi.')` com classe vazia fazia o helper ignorar as classes.
- Ativar/desativar com confirmação, mensagens de sucesso/erro, chips de estado, coluna "Funcionamento" (aberto agora) separada e aviso de pedidos em andamento.
- Tabelas administrativas viram cartões empilhados no celular.
- Defeito intermitente encontrado no E2E: o foco automático do modal "roubava" o foco do usuário e podia disparar validação indevida ao salvar endereço (falhava 2 de 12 vezes; agora 0 de 12).

## Não alterado
Regra de 15 km (inclusive 15,00 km), cálculo geográfico, preços, taxas, finalização de pedidos, banco, APIs e dados de demonstração.
