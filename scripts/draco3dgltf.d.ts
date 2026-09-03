/**
 * O `draco3dgltf` não publica tipos, e o `tsc --noEmit` do `typecheck` varre
 * `scripts/` junto com o resto. São duas funções, ambas usadas só aqui.
 */
declare module 'draco3dgltf' {
  interface Modulo {
    [chave: string]: unknown;
  }
  const draco3dgltf: {
    createEncoderModule(config?: object): Promise<Modulo>;
    createDecoderModule(config?: object): Promise<Modulo>;
  };
  export default draco3dgltf;
}
