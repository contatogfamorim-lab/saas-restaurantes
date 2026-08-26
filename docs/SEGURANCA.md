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
| 5 | **`audit_log` é imutável.** Insere; não atualiza, não apaga. Uma exceção, [descrita abaixo](#a-única-exceção-na-imutabilidade-do-audit_log). | `tests/db/schema.test.ts`, `tests/db/briefing.test.ts` | UPDATE e DELETE recusados para todo papel, incluindo `owner` e `postgres`. A exceção tem quatro casos negativos próprios |
| 6 | **Chave de servidor nunca no bundle.** | `pnpm check:secrets` | Varre `.next/static` **depois** do build. Validado plantando uma chave real num Client Component |
| 7 | **RLS em todas as tabelas**, e o anônimo lendo exatamente as 5 do cardápio. | `pnpm db:check-rls` | Confere nas duas direções — nem mais, nem menos. A versão que só checava "não escreve" passava por vacuidade |
| 8 | **Realtime escopado por restaurante.** | `pnpm check:realtime` | Assina os canais de verdade: o garçom de A leva `CHANNEL_ERROR: Unauthorized` no canal de B, e zero eventos |
| 9 | **Telefone mascarado por padrão**, valor cheio só com papel e com rastro. | `tests/db/gestao.test.ts` | Coluna revogada no GRANT; `reveal_guest_phone` confere papel e grava quem olhou — sem o número no log |
| 10 | **Porta fechada continua fechada.** Cada tela recusa quem não é dela. | `pnpm check:routes` | Login real e requisição real: garçom leva 403 em gestão, clientes, auditoria e editor de cardápio |
| 11 | **Força bruta freada.** | `pnpm check:forca-bruta` | Doze chutes pelo formulário real: bloqueia a partir do nono, e nem a senha certa passa com o balde cheio |
| 12 | **CSP com nonce nas duas superfícies.** | `pnpm check:csp` | Nonce presente, `unsafe-inline`/`unsafe-eval` ausentes, nonce diferente a cada requisição |
| 13 | **Saldo do cliente não vem do navegador.** O celular manda "quero usar"; o valor é do banco. | `tests/db/cashback.test.ts` | Teto de 30% conferido no centavo; chamada repetida recalcula em vez de somar |
| 14 | **Cookie válido não gasta saldo em mesa alheia.** | `tests/db/cashback.test.ts` | `resgatar_cashback` exige que o cliente esteja SENTADO naquela sessão |
| 15 | **CPF e senha do cliente não saem por GRANT nenhum.** | `tests/db/cashback.test.ts` | Colunas cruas fora do GRANT, como o telefone desde a 0009; `anon` sem acesso à tabela |

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
| A limpeza da demonstração **não funcionava** e derrubava a geração seguinte | Um teste novo esbarrando na imutabilidade do `audit_log` |
| A demonstração ocupava a mesa 10 no lugar da 4 (`order by label` é alfabético) | Abrir o mapa do salão e contar |
| **Todo pagamento que quitasse uma conta falharia**: `register_payment` roda com o papel do caixa, e eu revoguei dele a função de crédito | Os testes de caixa que já existiam |
| A tela do cliente dizia "nada por aqui ainda" com o saldo certo ao lado — faltava GRANT e a consulta era negada em silêncio | Abrir a tela e comparar com o banco |
| **Laço infinito entre `/app` e `/app/entrar`** para quem confirmava o e-mail e logava: tela preta, sem erro | O usuário abriu o sistema e mandou a captura |

### O laço, por extenso

Vale registrar porque a causa é estrutural, não um descuido pontual.

`exigirStaff()` mandava para `/app/entrar` todo mundo sem staff, e o `proxy.ts`
devolve para `/app` quem chega na porta COM sessão válida. Duas regras
discordando — o middleware supondo que ter sessão é poder usar o app, e o funil
mandando para a porta gente cuja sessão é perfeitamente válida. Quem tem conta e
ainda não tem perfil cai entre as duas e roda para sempre.

Pior: **três layouts tinham a própria cópia da regra**, chamando `getStaff()` e
redirecionando por conta própria. Corrigir só o funil não bastou — o layout
renderiza antes da página e era ele quem disparava o laço. Os três passaram a
chamar `exigirStaff()`, que agora distingue os três motivos de não haver staff:
sem sessão vai para a porta, sem perfil vai para o wizard, e desligado é
**deslogado** antes de ir para a porta (senão o cookie válido reabriria o mesmo
laço por outro caminho).

O bug existia antes deste trabalho e era inalcançável, porque `/comecar` não era
linkado de lugar nenhum. Linkar o cadastro o pôs no caminho principal.

O `check:routes` já dizia "nenhuma em laço" — e passava, porque testava as rotas
autenticadas só com perfil pronto. Agora o seed traz uma conta confirmada e sem
perfil, e dois casos percorrem `/app` e `/app/salao` com ela.

---

## A única exceção na imutabilidade do `audit_log`

Vale escrever por extenso, porque mexe numa regra declarada como inegociável.

A demonstração (§14) expira em 3 horas e apaga o restaurante inteiro. Ela
esbarrava em duas paredes ao mesmo tempo: `audit_log` tem trigger que barra
DELETE, e a FK dele para `restaurants` é `on delete restrict`. O efeito não era
"a demo fica guardada" — era pior: a exceção subia de dentro de
`gerar_demonstracao`, e o **próximo visitante** não conseguia gerar demo nenhuma.
O recurso morria três horas depois de entrar no ar.

`app.audit_log_is_append_only` passou a liberar o DELETE em um caso só, e a
condição é avaliada dentro do banco, sem confiar em quem chama:

1. é `DELETE` — `UPDATE` segue proibido sem condição nenhuma;
2. a linha pertence a um restaurante com `expires_at` preenchido, ou seja, uma
   demonstração;
3. e esse prazo **já venceu**.

O que a imutabilidade protege continua intocado: ninguém apaga a prova de que
mexeu num preço, nem o dono, nem o `postgres`. Restaurante de verdade tem
`expires_at` nulo e nunca satisfaz a condição — e a única coisa no sistema que
escreve nessa coluna é `gerar_demonstracao`.

Os quatro casos negativos em `tests/db/briefing.test.ts` existem para a fresta
continuar do tamanho em que foi aberta: o dono não apaga, o `postgres` não
apaga, demo **dentro** do prazo não apaga, e `UPDATE` não passa nem em demo
vencida. Sabotei a condição nas duas direções — tirando o prazo e tirando o
`expires_at` — e as três primeiras ficaram vermelhas.

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
