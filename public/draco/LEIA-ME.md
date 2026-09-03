# Decodificador Draco

Copiado de `node_modules/three/examples/jsm/libs/draco/gltf/` — não editar à mão.

O `DRACOLoader` do Three busca estes arquivos em tempo de execução, pela URL que
`setDecoderPath()` aponta (`/draco/`). Servir de CDN quebraria a CSP, que é
`default-src 'self'`; e deixar em `node_modules` não vira rota estática.

Só o par do glTF é necessário — `draco_wasm_wrapper.js` e `draco_decoder.wasm`.
A variante `draco_decoder.js` (asm.js, sem WASM) fica de fora: pesa o triplo e
todo navegador alvo tem WebAssembly.

Ao subir a versão do `three`, copiar de novo:

    cp node_modules/three/examples/jsm/libs/draco/gltf/draco_{decoder.wasm,wasm_wrapper.js} public/draco/
