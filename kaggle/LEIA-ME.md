# Digitalização 3D no Kaggle

O caderno `digitalizar-cardapio.ipynb` roda a parte que precisa de GPU.

## Por que existe

Gerar um modelo 3D a partir de foto exige 16 GB de VRAM no mínimo. O notebook em
que este projeto é desenvolvido tem 1,5 GB de gráficos integrados — não é caso de
otimizar, é ordem de grandeza. O Hugging Face resolve com GPU emprestada, mas a
conta gratuita dá **5 minutos por dia**, cerca de cinco pratos.

O Kaggle dá **30 horas por semana** de uma T4 de 16 GB, de graça e com cota fixa
que não oscila. É a diferença entre cinco pratos por dia e cardápios inteiros.

## A divisão do trabalho, e por que ela é assim

```
   Kaggle (GPU)                      Sua máquina (CPU)
   ────────────                      ─────────────────
   foto → malha crua                 baixa a malha crua
   sobe no bucket                    escala em metros
   marca bruto_path      ────────▶   remove a mesa
   status = processando              simplifica e comprime
                                     publica, status = pronto
```

O acabamento **não** foi reescrito em Python. Ele já existe em Node, já foi
depurado — inclusive contra defeitos que só apareceram na tela, como textura que
some por causa da CSP e mesa que vira geometria — e mantê-lo em um lugar só é o
que impede que as duas versões divirjam na primeira correção feita de um lado.

O preço dessa escolha é um passo manual: depois do caderno, rodar

```bash
pnpm modelos:gerar --acabar
```

## Segredos

O caderno lê dois valores dos *Secrets* do Kaggle (*Add-ons → Secrets*):

| nome | o quê |
|---|---|
| `SUPABASE_URL` | `https://<projeto>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | a chave `service_role` |

Nunca escreva a chave numa célula. Célula fica salva dentro do arquivo, e caderno
público entrega a chave para qualquer pessoa — e a `service_role` ignora toda a
RLS: quem a tem lê e escreve qualquer linha de qualquer restaurante.

## O que não foi testado

O caderno **nunca rodou**. Quem o escreveu não tem GPU nem conta no Kaggle, e a
parte frágil é justamente a primeira célula: o TRELLIS compila extensões CUDA, e
esse tipo de instalação costuma precisar de ajuste na primeira vez.

Se a instalação falhar, o erro estará nela — não na lógica de fila, que essa foi
exercitada de ponta a ponta com uma malha simulada.

A T4 tem exatamente o mínimo que o TRELLIS pede. A última célula do caderno traz
as duas saídas para erro de memória.
