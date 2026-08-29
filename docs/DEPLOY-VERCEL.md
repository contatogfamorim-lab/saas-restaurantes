# Deploy na Vercel

Passo a passo desta aplicação, não o genérico. O que já está pronto no
repositório está marcado; o resto precisa de você, porque envolve criar conta e
apertar botão em nome próprio.

---

## O que já está pronto

| | |
|---|---|
| Build passa **sem nenhuma variável** definida | conferido rodando `pnpm build` com o `.env.local` fora do lugar — o primeiro build da Vercel não quebra antes de você configurar |
| `remotePatterns` aceita `*.supabase.co` | as fotos do Storage carregam sem ajuste |
| `engines.node: >=24` | sem isso a Vercel escolhe a versão dela, e o build diverge da CI |
| `packageManager: pnpm@11.22.0` | a Vercel detecta o pnpm certo sozinha |
| `.env*` fora do git | `git check-ignore` confirma |

`output: "standalone"` é **desligado na Vercel** (`process.env.VERCEL`), e isso
não é preferência: com ele ligado o build QUEBRA no último passo —

```
Error: ENOENT: no such file or directory,
  open '/vercel/path0/.next/next-server.js.nft.json'
```

O Next grava os arquivos de rastreamento dentro de `.next/standalone/` e o
`onBuildComplete` da Vercel os procura na raiz do `.next`. Compila inteiro,
passa no TypeScript, gera as páginas, e morre no fim.

Fora da Vercel o standalone continua valendo — é o que faz o deploy em VM caber
em 48 MB em vez de 2,4 GB.

---

## 1. Um projeto no Supabase

Crie um projeto novo em [supabase.com](https://supabase.com) — plano free serve.
Guarde a senha do banco: ela aparece **uma vez**.

Em **Project Settings → API** ficam os três valores que você vai precisar.

### Aplicar as migrations

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref-do-projeto>
pnpm exec supabase db push
```

`db push` aplica as 33 migrations na ordem. Se alguma falhar, ela falha aqui e
não em produção — é o mesmo caminho que a CI exercita a cada push.

**Não rode o seed em produção.** Ele cria o Brasa Burger com cinco funcionários
de teste e senha conhecida. Para uma demonstração de portfólio, use o
`/comecar`: cria a conta, o restaurante e as mesas pelo fluxo real.

---

## 2. O repositório no GitHub

Hoje o repositório é **só local** — não há remote. A Vercel só faz deploy de um
repositório, então:

Com o `gh` instalado:

```bash
gh repo create pedidos-ia --private --source=. --push
```

Sem ele — que é o caso desta máquina — crie o repositório vazio pela web e:

```bash
git remote add origin git@github.com:<voce>/pedidos-ia.git
git push -u origin main
```

Privado é o padrão sensato: o repositório carrega decisões de segurança
comentadas em detalhe. Nada de segredo, mas é um mapa.

---

## 3. Importar na Vercel

**Add New → Project → Import** do GitHub. Framework detectado sozinho.

### As variáveis

Em **Settings → Environment Variables**, para Production e Preview:

| Nome | Tipo na Vercel | De onde vem |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Config** | Supabase → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Config** | Supabase → anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Supabase → service_role |
| `SESSION_COOKIE_SECRET` | **Secret** | `openssl rand -base64 48` |
| `EVOLUTION_API_URL` | **Secret** | endereço da sua Evolution (ver §6) |
| `EVOLUTION_API_KEY` | **Secret** | a `AUTHENTICATION_API_KEY` da Evolution |
| `MARKETING_WORKER_SECRET` | **Secret** | `openssl rand -base64 36` |

Ao salvar as duas primeiras a Vercel avisa: *"Remove the public framework prefix
to keep this value private"*. O aviso está certo e a resposta é **mudar o tipo
para Config** — não tirar o prefixo. Sem `NEXT_PUBLIC_` o Next não injeta o
valor no código do cliente, e o cardápio deixa de falar com o Supabase.

Todas as outras ficam **Secret**.

**As três últimas são opcionais.** Sem elas o sistema sobe e funciona inteiro —
só não manda mensagem. É de propósito: quem só quer cardápio, mesa e caixa não
precisa de WhatsApp para nada, e obrigar a preencher levaria a preencher com
lixo.

O `MARKETING_WORKER_SECRET` tem piso de 24 caracteres, e a rota é
**fail-closed**: sem ele configurado, `/api/marketing/tick` responde 401 para
todo mundo, inclusive em desenvolvimento. Liberar quando falta configuração
deixaria um endereço público capaz de disparar campanha de qualquer casa.

`DATABASE_URL` **não** é necessária: só os scripts de verificação a usam.

Se `SUPABASE_SERVICE_ROLE_KEY` for colada com o prefixo `NEXT_PUBLIC_` por
engano, ela vai para o bundle do navegador e entrega o banco inteiro, de todos
os restaurantes. `pnpm check:secrets` pega isso na CI — mas a CI roda no
GitHub, não na Vercel. Confira o nome ao colar.

---

## 4. Depois do primeiro deploy

### Redirecionamento do login

Em **Supabase → Authentication → URL Configuration**, ponha a URL da Vercel em
*Site URL*. Sem isso o link de confirmação de e-mail aponta para `localhost`.

### Criar o restaurante

Abra `https://<seu-projeto>.vercel.app/comecar` e siga os três passos: conta,
restaurante e briefing. O briefing pergunta o tipo de cozinha, o número de
mesas, o fuso e a taxa, e monta cardápio e mesas a partir das respostas.

**Quem só quer ver o sistema** marca "começar com o restaurante em movimento":
sai uma noite de serviço no meio — mesa esperando aprovação, prato na passagem,
item atrasado na chapa, comanda no caixa. Some sozinho em 3 horas — o login fica, e serve para montar
o restaurante de verdade depois.

**A confirmação de e-mail fica LIGADA** (é o padrão do Supabase hospedado). Quem
se cadastra recebe um link e precisa clicar antes de seguir. Custa um
ida-e-volta na caixa de entrada, e foi decisão deliberada: os cadastros serão de
gente real. Em *Authentication → URL Configuration*, a *Site URL* precisa ser a
da Vercel — senão o link do e-mail aponta para `localhost`.

É por isso que **não há credencial publicada em lugar nenhum**. Quem quiser
percorrer as telas cria a própria conta; login compartilhado numa página aberta
seria uma conta real, com senha real, num sistema real.

### Conferir que subiu inteiro

```bash
BASE_URL=https://<seu-projeto>.vercel.app pnpm check:csp
BASE_URL=https://<seu-projeto>.vercel.app pnpm check:routes
```

O `check:routes` faz login de verdade — vai precisar de `SMOKE_SENHA` e das
credenciais que você criar.

---

## A armadilha do portfólio

**Projeto free do Supabase pausa após 7 dias sem atividade.** Para um
restaurante de verdade isso nunca acontece. Para um link de portfólio, é fatal:
alguém abre três semanas depois e não funciona — e o que essa pessoa conclui
não é "o projeto estava pausado".

Um workflow agendado batendo no endereço uma vez por dia resolve. Não está
configurado ainda.

---

## O que NÃO fazer

- **Não rode o seed em produção.** Cinco contas com senha conhecida publicada
  no repositório.
- **Não use o plano Hobby se isso virar comercial.** Os termos da Vercel
  proíbem, e portfólio deixa de ser portfólio no dia em que um restaurante
  paga.
- **Não aponte a Vercel para o Supabase local.** `127.0.0.1` não existe do lado
  de lá.


---

## 6. WhatsApp: a Evolution e o worker

Duas peças que **não** rodam na Vercel, e moram na mesma máquina.

### Por que não na Vercel

A Evolution mantém a sessão do WhatsApp aberta — é um processo de vida longa
com estado em disco. Função serverless morre entre requisições; a sessão
morreria junto, e cada instância pediria o QR de novo.

O worker é o mesmo caso por outro motivo: o `tick` devolve em quantos
milissegundos vale a pena chamar de novo, para respeitar o intervalo de 40 a
90 segundos entre mensagens. O cron da Vercel tem granularidade de **um
minuto** no plano Pro — e de **um dia** no Hobby. Uma campanha de 200 pessoas
levaria três horas e meia no Pro, e duzentos dias no Hobby.

### A máquina

Qualquer VM com 2 GB de RAM e disco persistente serve. O que ela precisa
sustentar: a Evolution, um Postgres ou Redis para o estado dela, e um processo
Node de vinte linhas.

**Oracle Cloud Always Free** cabe com folga (4 núcleos ARM, 24 GB) e é grátis
para sempre. Dois avisos honestos, que valem mais que a economia:

- **capacidade.** As instâncias ARM (Ampere A1) vivem indisponíveis em várias
  regiões — "Out of host capacity" é o erro mais comum de quem tenta criar.
  Pode levar dias tentando, ou nunca sair.
- **recuperação.** A Oracle reclama recursos gratuitos ociosos. A máquina que
  sustenta a sessão do WhatsApp não pode sumir de madrugada: quando voltar,
  toda instância pede o QR outra vez, e ninguém percebe até uma campanha não
  sair.

Para **testar**, é a escolha certa: é grátis e é suficiente. Para o dia em que
um restaurante de verdade depender disso, uma VPS paga de 4 a 6 euros por mês
(Hetzner CX22, por exemplo) tira as duas incertezas — e é menos que o custo de
uma noite de campanha que não saiu.

### Subir a Evolution

```
docker run -d --name evolution --restart always \
  -p 8080:8080 \
  -v evolution_instances:/evolution/instances \
  -e AUTHENTICATION_API_KEY='troque-por-um-valor-longo-e-aleatorio' \
  atendai/evolution-api:latest
```

O `-v` é o que importa: sem volume, reiniciar o container apaga a sessão.

Ponha a Evolution atrás de HTTPS antes de usar de verdade — a
`AUTHENTICATION_API_KEY` viaja em cabeçalho, e em HTTP puro ela viaja em texto
aberto. Caddy ou nginx com Let's Encrypt resolvem em dez minutos.

### Subir o worker

Na mesma máquina, com o arquivo `worker/marketing-worker.mjs` deste repositório:

```
PEDIDOS_IA_URL=https://seu-app.vercel.app \
MARKETING_WORKER_SECRET=<o mesmo valor da Vercel> \
node worker/marketing-worker.mjs
```

Ele confere URL e secret **antes** de entrar no laço, e morre com mensagem
própria se o secret não bater — que é o tropeço mais comum da instalação. Se o
app tiver subido sem `EVOLUTION_API_URL`, ele avisa no primeiro segundo em vez
de marcar destinatário como falho um a um.

Em produção, ponha sob `systemd` ou num container com `--restart always`: o
worker sai limpo no SIGTERM, terminando o tick em andamento antes.

### Conectar o número de cada restaurante

Uma instância da Evolution por restaurante. O nome dela vai em
**Gestão → Configurações → WhatsApp**, e é ele que o sistema usa para saber por
qual número mandar. Sem instância configurada, `iniciar_campanha` recusa — e a
tela de Campanhas diz "Desligado" em vez de deixar você escrever a campanha
inteira para descobrir no último clique.
