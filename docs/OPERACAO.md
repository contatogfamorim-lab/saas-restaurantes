# Operação

O que precisa estar configurado, o que quebra primeiro e o que fazer quando
quebrar. Os números aqui estão espalhados em comentários pelo código — este
arquivo existe porque ninguém encontra um comentário às duas da manhã de um
sábado.

---

## Variáveis de ambiente

Em produção elas ficam no cofre do provedor, nunca em arquivo. `.env*` está no
`.gitignore` e nenhuma delas entra em imagem de container.

| Variável | Vai para o navegador? | O que acontece se vazar |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Sim, por design** | Nada. É o endereço público da API. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Sim, por design** | Nada além do que a RLS já permite ao anônimo — hoje, as cinco tabelas do cardápio público. É por isso que a RLS é a fronteira e não a chave. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Nunca** | Ignora RLS. Entrega o banco inteiro, de **todos** os restaurantes. |
| `SESSION_COOKIE_SECRET` | **Nunca** | Permite forjar o cookie de sessão de mesa e abrir comanda em qualquer mesa (§10.4). |
| `DATABASE_URL` | **Nunca** | Conexão direta ao Postgres. Só usada por scripts de verificação. |

`pnpm check:secrets` varre `.next/static` depois do build e falha se qualquer
chave de servidor aparecer. Roda na CI, depois do build — antes seria vacuidade,
sem nada para varrer.

`SESSION_COOKIE_SECRET` precisa de 32+ caracteres:

```bash
openssl rand -base64 48
```

---

## O que quebra primeiro

Os dois tetos do plano Pro do Supabase, e nenhum deles é o banco.

### 1. Conexões de Realtime — 500 simultâneas

Só as telas da **equipe** assinam: salão, cozinha, caixa. São ~6 conexões por
restaurante, o que dá teto para ~80 restaurantes.

O celular do **cliente** não assina nada. Ele usa polling de 10 s
(`lib/menu/use-order-status.ts`). Foi uma decisão de capacidade, não de
simplicidade: assinar o cliente derrubaria o teto de ~80 restaurantes para ~9.

**Se isso mudar**, o número a olhar é `realtime.connections` no painel do
Supabase. Sintoma: telas da equipe param de atualizar sozinhas e a faixa
vermelha "Sem conexão" aparece — que é o comportamento desenhado, e não uma
falha silenciosa.

### 2. Egress — as fotos

Foto de produto é servida a até **50 KB**, em WebP, e a conversão acontece no
navegador de quem sobe (`lib/cardapio/comprimir-foto.ts`). O upload original
nunca chega ao servidor.

Servir o JPEG original derrubaria a capacidade de ~200 mil para ~40 mil
aberturas de cardápio por mês. `next/image` reencoda ao servir e o cache é de
30 dias (`next.config.ts`).

**Sintoma de estouro**: conta do mês, não erro. Vale acompanhar antes.

---

## Deploy

### Ordem, e por que ela importa

```
1. migrations   →  supabase db push
2. aplicação    →  build + deploy
```

Nesta ordem, e não na inversa. O banco novo atende a aplicação antiga — colunas
a mais não incomodam ninguém. A aplicação nova contra o banco antigo quebra na
primeira consulta a uma coluna que ainda não existe.

Isso obriga migrations **compatíveis para trás**: acrescentar coluna nullable em
vez de renomear, criar a nova antes de largar a velha. Renomear coluna em uma
migration só é o jeito mais rápido de derrubar o sistema entre os dois passos.

### Antes de apertar o botão

```bash
pnpm verify
```

Roda os mesmos nove passos da CI, na mesma ordem, incluindo o servidor de
produção de verdade. Se passar aqui e falhar lá, é diferença de ambiente e vale
investigar — não repetir.

---

## Quando quebra

### As telas da equipe pararam de atualizar

Não é perda de dado. O Realtime só avisa *que* algo mudou; a tela recarrega do
servidor, sob RLS. Com ele fora do ar, a informação continua correta — fica
velha.

1. A faixa vermelha aparece? Então a tela **sabe** que está desatualizada, e
   quem está usando também. Foi desenhado assim: o oposto é a tela mentir em
   silêncio.
2. `realtime` no painel do Supabase — status e contagem de conexões.
3. Recarregar a página reassina. Ao reconectar, a tela recarrega sozinha.

### O cardápio abriu vazio

Provavelmente RLS, e quase sempre no anônimo.

```bash
pnpm db:check-rls
```

Confere que o anônimo lê **exatamente** as cinco tabelas do cardápio e escreve
em nenhuma. Nem mais, nem menos — as duas direções importam: já aconteceu de as
tabelas nascerem sem `GRANT`, o script dar verde e o cardápio não abrir.

Se o restaurante estiver com `active = false`, some tudo. É o comportamento
correto e o primeiro lugar a olhar.

### Alguém mexeu no preço e ninguém sabe quem

```sql
select created_at, actor_id, before, after
  from audit_log
 where action = 'product.price_changed'
 order by created_at desc;
```

`audit_log` é **imutável**: insere, não atualiza, não apaga — nem o
administrador. Toda alteração de preço, desconto, taxa de serviço, liberação
forçada de mesa e revelação de telefone passa por lá.

O console tem isso em **Gestão → Auditoria**, e o histórico de cada item aparece
na própria tela de edição — quem está prestes a mexer no preço é exatamente
quem precisa ver que ele já mudou três vezes esta semana.

### O QR de uma mesa parou de funcionar

O `short_code` é aleatório de 10 caracteres e **não muda** quando a mesa é
renomeada. Se parou:

1. A mesa está `active`? Mesa desativada devolve 404 de propósito.
2. O restaurante está `active`?
3. O código impresso confere com **Gestão → Mesas**? Reimprimir é barato.

O código aparece escrito por extenso embaixo do QR justamente para o dia em que
a câmera não lê — tela rachada, lente suja, luz baixa. Alguém digita.

---

## O que este documento NÃO cobre

- **Backup e restauração.** O Supabase faz backup diário no plano Pro, mas o
  procedimento de restauração nunca foi ensaiado aqui. Ensaiar é diferente de
  ter — e "temos backup" sem restauração testada é uma frase, não uma garantia.
- **Monitoramento e alerta.** Não há nada configurado. Hoje se descobre que
  quebrou porque alguém avisa.
- **Rate limiting na borda.** `create_guest_order` limita 6 pedidos/minuto por
  sessão, no banco. Não há limite por IP em nenhuma camada — é assunto da
  Etapa 12.
- **CSP.** Os outros cabeçalhos de segurança estão no `next.config.ts`; a CSP
  ficou de fora de propósito, porque mal calibrada ela apaga a tela da cozinha
  no meio do serviço. Também Etapa 12.
