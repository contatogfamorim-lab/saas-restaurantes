# Sistema de pedidos por mesa (NFC/QR)

Multi-tenant desde a primeira linha. Cada mesa tem uma etiqueta NFC com QR
impresso como fallback; o cliente encosta o celular, o cardápio abre sem login,
monta o pedido e envia. O pedido **não vai direto para a cozinha** — cai numa
fila de aprovação do garçom, e só depois de aprovado entra em produção e o
cronômetro começa.

## Pré-requisitos

| | Versão | Observação |
|---|---|---|
| Node | 24 LTS | `.nvmrc` no projeto; `nvm use` acerta sozinho |
| pnpm | 11.x | via `corepack enable` |
| Docker | qualquer | Colima nesta máquina — `colima start` |

Node 20 **não serve**: saiu do suporte em abril/2026 e o pnpm 11 exige ≥ 22.13.

## Subir o ambiente local

```bash
nvm use && pnpm install
pnpm db:start          # sobe o Supabase local (sem Studio — ver nota de disco)
cp .env.example .env.local   # preencha com o que o db:start imprimiu
pnpm db:reset          # aplica as migrations e roda o seed
pnpm db:photos         # baixa e sobe as 30 fotos de teste para o Storage
pnpm db:types          # gera src/lib/supabase/database.types.ts
pnpm dev
```

`db:reset` limpa o banco, e com ele os registros do Storage — rode `db:photos`
logo depois, sempre. As fotos são material de teste (Unsplash, licença livre);
no cliente real elas vêm do onboarding.

`pnpm db:start` sobe um subconjunto dos serviços (`-x studio,edge-runtime,…`)
porque esta máquina tem pouco disco livre. Para o stack completo:
`pnpm exec supabase start`.

## Verificação

```bash
pnpm verify      # typecheck + lint + testes unitários + RLS em todas as tabelas
pnpm test:db     # testes contra o Postgres real (precisa do banco no ar)
pnpm build && pnpm check:secrets   # varre o bundle atrás de segredo vazado
```

## Credenciais do seed

Dados de **desenvolvimento**. Não reaproveitar em lugar nenhum.

Senha de todos: `senha-de-teste-123`

| E-mail | Funções | PIN |
|---|---|---|
| `dono@cantinadobeco.test` | `owner` | 7391 |
| `garcom@cantinadobeco.test` | `waiter` | 4762 |
| `cozinha@cantinadobeco.test` | `kitchen` | 9138 |
| `caixa@cantinadobeco.test` | `cashier` | 2957 |
| `duplo@cantinadobeco.test` | `waiter` + `cashier` | 6483 |

O último existe para provar o acúmulo de funções: uma pessoa, um cadastro,
`roles` como array — e acesso às duas telas sem deslogar.

## Arquitetura — as decisões que não se negociam

**Dinheiro em centavos (`integer`), nunca `float`.** Timezone
`America/Sao_Paulo`, locale `pt-BR`.

**Snapshot de preço.** `order_items.unit_price_cents` e
`order_item_modifiers` guardam nome e valor do momento do pedido. Mudar o preço
amanhã não altera a conta de hoje — garantido por trigger, não por convenção.
Nunca calcule total com `JOIN` em `products.price_cents`.

**Uma sessão aberta por mesa.** Índice único parcial em `table_sessions`. A
corrida entre dois celulares abrindo a mesma mesa falha no `INSERT`.

**Total sempre derivado.** Nunca desnormalizado. Veja a view `session_totals`.

**Isolamento entre tenants é estrutural.** Além da RLS, os FKs são compostos
`(id, restaurant_id)`: uma linha do restaurante A não consegue apontar para uma
do B nem por bug de aplicação.

**`service_role` ignora RLS.** Por isso o que precisa valer para todo mundo
está em trigger, não em policy: imutabilidade do `audit_log`, congelamento do
preço do item, máquina de estados, e a proibição de editar os próprios `roles`.

**O celular do cliente não abre Realtime.** Status por polling de 10s. O plano
Pro dá 500 conexões para a plataforma inteira; assinar o cliente derrubaria o
teto de ~80 restaurantes para ~9.

**Preço tem uma fonte só.** A view `product_effective_prices` responde "quanto
custa isto agora", e tanto o cardápio quanto a criação do pedido perguntam para
ela. É o que garante que o preço exibido seja o preço cobrado.

**O cliente nunca manda valor.** O corpo de `POST /api/pedidos` carrega apenas
`productId`, `qty`, `modifierOptionIds`, `notes` e `guestId`. Todo o resto —
preço, promoção, estação, curso — é decidido dentro de `create_guest_order()`,
em uma transação. Se um campo monetário aparecer no request, o desenho está
errado.

**`session_id` só vem do cookie assinado.** Nunca de body, query ou header.
Aceitar de outro lugar seria IDOR: trocar um uuid daria acesso à comanda da
mesa ao lado.

## Estrutura

```
supabase/migrations/   12 migrations versionadas — nunca editar schema à mão
supabase/seed.sql      só local e staging
src/lib/permissions.ts matriz de permissão — FONTE ÚNICA (spec §10.3)
src/lib/supabase/       client (browser) · server (equipe, RLS) · admin (service_role)
scripts/               guardas de CI: RLS em todas as tabelas, segredo no bundle
tests/                 unitários (sem banco)
tests/db/              contra o Postgres real
```

### Qual client do Supabase usar

| Situação | Módulo | RLS |
|---|---|---|
| Telas da equipe, leitura e escrita | `@/lib/supabase/server` | vale |
| Realtime nas telas da equipe | `@/lib/supabase/client` | vale |
| Route Handler do cliente, após validar o cookie | `@/lib/supabase/admin` | **ignorada** |

Mutação de tela de equipe **não** pode passar pelo admin: isso desligaria a RLS
e os guardas de coluna que dependem de `auth.uid()`.
