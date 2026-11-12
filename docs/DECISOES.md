# Decisões técnicas — Sabor Express

## 1. Regra de entrega: 15 km (definitiva)

Substitui integralmente os 60 km dos documentos do projeto (`Árvore de Decisão` e `Processo de Desenvolvimento`,
que ainda citam 60 km e devem ser atualizados).

| Item | Decisão | Onde |
|---|---|---|
| Ponto de referência | Localização do **estabelecimento** → **endereço de entrega** do cliente (pergunta 10 do levantamento) | `domain/delivery.js` |
| Metodologia | **Linha reta (Haversine)**, não a rota pelas ruas. Documentos não especificam; é a escolha consistente, barata e determinística | `domain/geo.js` |
| Arredondamento | Metro mais próximo, antes de comparar | `evaluateDelivery` |
| Exatamente 15 km | **Incluído** (15.000 m aceito; 15.001 m recusado) | `MAX_DELIVERY_METERS` |
| Sem dados suficientes | **Nunca aprova**: sem coordenadas do endereço ou da loja → recusa (`ADDRESS_NO_COORDS` / `RESTAURANT_NO_COORDS`); serviço de localização fora → `503 GEO_UNAVAILABLE` | `orderService.assertDeliverable` |
| Onde valida | **Backend**, na listagem, na cotação e (de novo, dentro da transação) no checkout. O pedido recebe só `address_id`; coordenadas/distância enviadas pelo cliente são ignoradas | `orderService`, `catalogService` |
| Endereço alterado | Coordenadas antigas são descartadas quando o texto muda; o checkout envia a “versão” do endereço e o servidor responde `409 ADDRESS_CHANGED` se mudou | `addressService`, `createOrder` |
| Mensagem | Distância mostrada arredondada **para cima** (nunca “15,0 km” para algo recusado) | `kmLabel` |

Testes: `tests/delivery15km.test.js` (31) — 5; 14,9; 15,0; 15,1 km; endereço sem coordenadas; falha do geocodificador;
troca de endereço durante a compra; tentativas de burlar pelo frontend.

## 2. Arquitetura

Camadas conforme o documento de arquitetura: apresentação (SPA) → rotas/API REST → serviços → domínio → persistência (SQLite).
Sem dependências npm: menor superfície de ataque e de manutenção. Trade-off: parser multipart e roteador próprios (cobertos por testes).

Segurança: senhas scrypt; sessão JWT HS256 em cookie `HttpOnly; SameSite=Strict` (+`Secure` em produção) com `token_version`
(troca/redefinição de senha invalida sessões); CSRF por cabeçalho; rate-limit; CSP/HSTS; uploads validados pelos bytes (JPG/PNG/WebP, 3 MB),
nome aleatório; consultas parametrizadas; textos de usuário sempre como nós de texto no DOM (sem `innerHTML`).

Pedidos: preço **sempre do banco**; transação atômica `BEGIN IMMEDIATE`; idempotência por `idempotency_key`; máquina de estados com papéis;
aceite de entrega concorrente resolvido por `UPDATE … WHERE courier_id IS NULL`.

## 3. Riscos conhecidos

- **R1 — Coordenadas do aparelho (GPS) como reserva.** Quando o geocodificador não acha o endereço (ou está fora), o servidor aceita as coordenadas
  do GPS enviadas no cadastro do endereço. Um usuário malicioso poderia enviar coordenadas falsas **perto do restaurante** ao cadastrar um endereço
  que o geocodificador desconhece. Mitigações possíveis: `ALLOW_DEVICE_COORDS=false` em produção com geocodificador comercial confiável (recomendado).
  Não há como o servidor verificar um GPS. Endereços cadastrados com GPS ficam marcados `coords_source = 'device'` (visível ao admin).
- **R2 — Distância em linha reta** pode ser menor que o trajeto real (rios, vias). Se o negócio quiser distância por rota, trocar `evaluateDelivery` por um serviço de rotas (a validação já está centralizada).
- **R3 — Instância única.** SQLite + rate-limit em memória. Para múltiplas instâncias: PostgreSQL e Redis.
- **R4 — Atualização por polling** (8–10 s) em vez de WebSocket/push.
- **R5 — Nominatim público** tem política de uso (1 req/s). Use provedor comercial para volume real.
