'use client';

import { useEffect } from 'react';
import { PrinterIcon } from 'lucide-react';

/**
 * Botão de imprimir do cupom.
 *
 * Client component mínimo: `window.print()` não existe no servidor, e a conta
 * inteira é renderizada no servidor de propósito — valor de conta não deveria
 * depender de JavaScript ter carregado.
 *
 * Abre o diálogo de impressão sozinho ao carregar, porque quem abre esta página
 * já decidiu imprimir: ela só é alcançada pelo botão "Conta" do caixa.
 */
export function PrintButton() {
  useEffect(() => {
    // Um quadro de atraso para as fontes assentarem — imprimir antes disso sai
    // com a fonte de fallback e as colunas desalinhadas.
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-12 items-center gap-2 rounded-lg bg-neutral-900 px-5 text-[15px] font-semibold text-white"
    >
      <PrinterIcon className="size-4" />
      Imprimir
    </button>
  );
}
