import { transform } from 'esbuild';
import { defineConfig } from 'vitest/config';

/**
 * Vite 8's own transformer (Oxc) implements no decorators at all: it preserves `@Entity()` verbatim,
 * which Node then rejects with a SyntaxError. esbuild downlevels the standard (TC39) decorators UQL
 * uses, with the same semantics tsc gives UQL's published `dist`.
 *
 * The transform is paid once at load time, never inside a `bench()` body, so it skews nothing measured.
 */
function esbuildTypeScript() {
  return {
    name: 'bench:esbuild-typescript',
    async transform(code: string, id: string) {
      if (!/\.m?ts$/.test(id) || id.includes('node_modules')) {
        return null;
      }
      const result = await transform(code, {
        loader: 'ts',
        target: 'es2025',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  oxc: false,
  plugins: [esbuildTypeScript()],
  test: {
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
  },
});
