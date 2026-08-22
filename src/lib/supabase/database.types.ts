/**
 * PLACEHOLDER — este arquivo é GERADO, não escrito à mão.
 *
 *   pnpm db:types
 *
 * (equivale a `supabase gen types typescript --local > src/lib/supabase/database.types.ts`)
 *
 * Enquanto o banco não subiu, o tipo abaixo mantém o projeto compilando sem
 * fingir que existe um schema tipado. Ele é deliberadamente permissivo: assim
 * que `pnpm db:types` rodar, ele é substituído e o TypeScript passa a cobrar
 * nome de tabela, coluna e enum em toda query.
 */
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> }>;
    Views: Record<string, { Row: Record<string, unknown> }>;
    Functions: Record<string, unknown>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, unknown>;
  };
};
