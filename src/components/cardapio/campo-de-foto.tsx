'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CameraIcon, CameraOffIcon, Trash2Icon } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { comprimirFoto, FotoInvalida, ALVO_BYTES } from '@/lib/cardapio/comprimir-foto';
import { registrarFoto, removerFoto } from '@/app/app/(cardapio)/cardapio/actions';

/**
 * Foto do prato (spec §13.2).
 *
 * O ARQUIVO ORIGINAL NÃO SOBE. O navegador redimensiona, converte para WebP e
 * comprime até caber em 50 KB; o que vai para o Storage já é a versão que o
 * cliente vê. É a leitura mais literal de "nunca sirva o upload original": ele
 * não chega a existir no servidor.
 *
 * O upload vai direto do navegador para o Storage, e não por uma Server Action,
 * por dois motivos: o arquivo não precisa passar pelo servidor do Next só para
 * ser reenviado, e a policy do bucket já exige `menu.content` mais a pasta do
 * próprio restaurante. Depois de subir, a Action só grava a URL no produto —
 * e confere de novo que a pasta é a do restaurante de quem está logado.
 */
export function CampoDeFoto({
  produtoId,
  fotoUrl,
  nome,
  podeEditar,
}: {
  produtoId: string;
  fotoUrl: string | null;
  nome: string;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [pendente, iniciar] = useTransition();
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function escolher(arquivo: File) {
    setErro(null);
    setAviso(null);
    setSubindo(true);

    try {
      const pronta = await comprimirFoto(arquivo);

      const supabase = createClient();
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error('Sessão expirada. Entre de novo.');

      // A pasta é o restaurante, e vem do perfil — a policy do bucket confere
      // que bate com `app.current_restaurant_id()`, então errar aqui não vira
      // gravação no restaurante alheio, vira erro.
      const { data: perfil } = await supabase
        .from('profiles')
        .select('restaurant_id')
        .eq('id', sessao.user.id)
        .single();

      const caminho = `${perfil!.restaurant_id}/${pronta.arquivo.name}`;

      const { error } = await supabase.storage
        .from('product-photos')
        .upload(caminho, pronta.arquivo, {
          contentType: 'image/webp',
          cacheControl: '31536000',
        });

      if (error) throw new Error(error.message);

      const fd = new FormData();
      fd.set('id', produtoId);
      fd.set('caminho', caminho);

      const r = await registrarFoto(fd);
      if (!r.ok) throw new Error(r.erro ?? 'Não deu certo');

      setAviso(
        `Pronta: ${Math.round(pronta.bytes / 1024)} KB, ${pronta.largura}×${pronta.altura}.`,
      );
      router.refresh();
    } catch (err) {
      setErro(
        err instanceof FotoInvalida || err instanceof Error
          ? err.message
          : 'Não deu certo',
      );
    } finally {
      setSubindo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  function remover() {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const r = await removerFoto(produtoId);
      if (!r.ok) setErro(r.erro ?? 'Não deu certo');
      else router.refresh();
    });
  }

  const ocupado = subindo || pendente;

  return (
    <div>
      {/* Limitada: a foto aparece com ~375 CSS px no celular do cliente, e
          esticar 16:9 num monitor de 27" empurra o formulário inteiro para
          fora da tela sem mostrar nada a mais. */}
      <div className="relative aspect-[16/9] w-full max-w-md overflow-hidden rounded-lg bg-secondary">
        {fotoUrl ? (
          <Image
            src={fotoUrl}
            alt={nome}
            fill
            // A caixa tem no máximo 448 px (max-w-md). Pedir 820 fazia o
            // next/image gerar e servir 1920 — bytes que ninguém vê, no
            // egress que a §13.2 manda vigiar.
            sizes="(max-width: 480px) 100vw, 448px"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <CameraOffIcon className="size-6" />
            <p className="text-[12px]">Sem foto</p>
          </div>
        )}

        {ocupado && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[13px]">
            {subindo ? 'Preparando a foto…' : 'Salvando…'}
          </div>
        )}
      </div>

      {podeEditar && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            className="sr-only"
            id={`foto-${produtoId}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void escolher(f);
            }}
          />
          <label
            htmlFor={`foto-${produtoId}`}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-3 text-[13px] font-semibold"
          >
            <CameraIcon className="size-4" />
            {fotoUrl ? 'Trocar foto' : 'Escolher foto'}
          </label>

          {fotoUrl && (
            <button
              type="button"
              onClick={remover}
              disabled={ocupado}
              className="flex h-10 items-center gap-1.5 rounded-md px-3 text-[13px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              <Trash2Icon className="size-4" />
              Remover
            </button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Convertida para WebP e reduzida a até {ALVO_BYTES / 1024} KB aqui no
            aparelho.
          </p>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-2 text-[13px] text-alert-critical">
          {erro}
        </p>
      )}
      {aviso && !erro && (
        <p role="status" className="mt-2 text-[12px] text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  );
}
