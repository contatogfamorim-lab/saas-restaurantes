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

`output: "standalone"` fica no `next.config.ts` e **não atrapalha** aqui — a
Vercel faz o próprio recorte. Ele existe para deploy em VM ou container.

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
gh repo create markello --private --source=. --push
```

Sem ele — que é o caso desta máquina — crie o repositório vazio pela web e:

```bash
git remote add origin git@github.com:<voce>/markello.git
git push -u origin main
```

Privado é o padrão sensato: o repositório carrega decisões de segurança
comentadas em detalhe. Nada de segredo, mas é um mapa.

---

## 3. Importar na Vercel

**Add New → Project → Import** do GitHub. Framework detectado sozinho.

### As variáveis

Em **Settings → Environment Variables**, para Production e Preview:

| Nome | De onde vem |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → service_role · **nunca com prefixo NEXT_PUBLIC** |
| `SESSION_COOKIE_SECRET` | `openssl rand -base64 48` |

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
restaurante, mesas. Ao final você cai na folha de QR.

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
