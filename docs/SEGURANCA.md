# Segurança: o que é verificado, e onde

A §10.11 pede uma bateria de verificação de segurança. Este arquivo é o mapa
dela: cada propriedade, onde ela é provada, e — quando é o caso — o que
continua descoberto.

Nada aqui é reimplementação. As verificações moram junto do código que
protegem; a tabela existe porque uma propriedade de segurança espalhada em
nove arquivos é uma propriedade que ninguém consegue auditar.

**Todas rodam na CI.** Uma verificação que depende de alguém lembrar de
executá-la não verifica nada.

---

## A bateria

| # | Propriedade | Onde é provada | Como se sabe que a prova vale |
|---|---|---|---|
| 1 | **Isolamento entre restaurantes.** Um token do restaurante A não lê nenhuma linha do B. | `tests/db/schema.test.ts` — varre as 22 tabelas nas duas direções | Criar um segundo restaurante e conferir `count = 0` em cada tabela, para os dois lados |
| 2 | **O servidor não confia no cliente.** Preço, total e desconto nunca vêm do navegador. | `tests/db/orders.test.ts` | Injetar `unit_price_cents: 1` pelo HTTP real: o item entra a 700, que é o preço do catálogo |
| 3 | **`session_id` só do cookie assinado.** Nunca do corpo, da query ou de header. | `tests/db/orders.test.ts` | Forjar `sessionId` no corpo produz **zero** pedidos na sessão forjada |
| 4 | **Ninguém edita os próprios papéis.** Nem o administrador. | `tests/db/schema.test.ts`, `tests/permissions.test.ts` | Trigger `forbid_self_role_escalation` + `canEditStaffRoles` |
| 5 | **`audit_log` é imutável.** Insere; não atualiza, não apaga. | `tests/db/schema.test.ts` | UPDATE e DELETE recusados para todo papel, incluindo `owner` |
| 6 | **Chave de servidor nunca no bundle.** | `pnpm check:secrets` | Varre `.next/static` **depois** do build. Validado plantando uma chave real num Client Component |
| 7 | **RLS em todas as tabelas**, e o anônimo lendo exatamente as 5 do cardápio. | `pnpm db:check-rls` | Confere nas duas direções — nem mais, nem menos. A versão que só checava "não escreve" passava por vacuidade |
| 8 | **Realtime escopado por restaurante.** | `pnpm check:realtime` | Assina os canais de verdade: o garçom de A leva `CHANNEL_ERROR: Unauthorized` no canal de B, e zero eventos |
| 9 | **Telefone mascarado por padrão**, valor cheio só com papel e com rastro. | `tests/db/gestao.test.ts` | Coluna revogada no GRANT; `reveal_guest_phone` confere papel e grava quem olhou — sem o número no log |
| 10 | **Porta fechada continua fechada.** Cada tela recusa quem não é dela. | `pnpm check:routes` | Login real e requisição real: garçom leva 403 em gestão, clientes, auditoria e editor de cardápio |
| 11 | **Força bruta freada.** | `pnpm check:forca-bruta` | Doze chutes pelo formulário real: bloqueia a partir do nono, e nem a senha certa passa com o balde cheio |
| 12 | **CSP com nonce nas duas superfícies.** | `pnpm check:csp` | Nonce presente, `unsafe-inline`/`unsafe-eval` ausentes, nonce diferente a cada requisição |

---

## Cada guarda foi vista falhando

Guarda que nunca falhou não é guarda — é uma linha verde. Todas as verificações
acima foram testadas contra sabotagem deliberada, e três delas já passaram por
vacuidade antes de serem consertadas:

- `check-rls` dava verde enquanto as tabelas nasciam **sem GRANT** e a RLS nem
  chegava a ser avaliada;
- `check-secrets` foi validado plantando uma chave de service role de verdade
  num Client Component;
- o helper `esperaFalhar` de um teste **casava a asserção consigo mesma** e
  aprovava exatamente o caso que existia para reprovar.

Achados encontrados por sabotagem, não por revisão:

| O que estava aberto | Como apareceu |
|---|---|
| A cozinha criava produto a R$ 99, driblando o `menu.price` do dono | Testar o INSERT, não só o UPDATE |
| Qualquer anônimo listava **todos os clientes da plataforma** | Perguntar o que o anon lê, tabela por tabela |
| O garçom de A enxergava a linha do canal de B | Conferir a policy contra a LINHA, não só contra o tópico |
| Item esgotado voltava ao cardápio | Um teste do KDS, depois de eu reescrever uma policy e apagar três condições sem perceber |
| "Qual cardápio está no ar" era sorteio entre versões | Um teste instável investigado em vez de reexecutado |
| Login sem freio nenhum | Medir que o GoTrue não vê o IP do cliente quando o login é Server Action |
| O cardápio do cliente — a página mais exposta — sem CSP | Incluí-la no `check:csp` e ver o `✗` |

---

## O que continua descoberto

Escrito aqui porque a §10.12 é explícita: **não afirme que o sistema está
seguro.**

- **Trancar conta alheia.** Quem souber o código de operador de alguém o tranca
  por dez minutos errando a senha oito vezes. É o preço de qualquer freio por
  conta; o outro lado — não ter freio — é pior. Mitigar de verdade pede captcha
  ou segundo fator, fora do escopo declarado.
- **`x-forwarded-for` é do cliente** quando não há proxy confiável na frente.
  Por isso o balde de origem é o secundário: o que segura força bruta contra uma
  conta é o balde de conta, que não depende de nada que o cliente possa mentir.
- **Sem rate limiting nas portas públicas.** `create_guest_order` limita 6
  pedidos/minuto por sessão, no banco. Abrir cardápio e abrir sessão de mesa não
  têm limite nenhum.
- **`products_column_guard` não vale sob `service_role`** — `auth.uid()` é nulo
  ali. Por isso nenhuma escrita do editor usa o client de admin, mas é uma
  disciplina, não uma trava.
- **Sem revisão externa.** Nada aqui foi olhado por outra pessoa nem passou por
  ferramenta de análise de segurança.
- **Sem teste de carga.** Os tetos da `OPERACAO.md` são cálculo, não medição.
- **A CI nunca rodou no GitHub Actions.** Cada passo roda localmente na mesma
  ordem, mas versões de action e `supabase start` no runner só o primeiro push
  vai dizer.
