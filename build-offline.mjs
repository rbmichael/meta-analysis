// esbuild build script for the offline bundle.
// Patches ui.js at build time to replace the runtime cache-buster const with
// an empty string so esbuild can statically analyze the dynamic import() paths
// and bundle them inline. Without this, import(`./foo.js${_cb}`) is a
// non-static path that esbuild leaves as a live import() call, which fails at
// runtime because an IIFE bundle has no module loader.

import { build } from 'esbuild';
import { readFileSync } from 'fs';

await build({
  entryPoints: ['js/ui/ui.js'],
  bundle: true,
  outfile: 'bundle.js',
  format: 'iife',
  globalName: 'App',
  plugins: [{
    name: 'strip-cache-buster',
    setup(b) {
      b.onLoad({ filter: /[/\\]ui\.js$/ }, args => {
        const contents = readFileSync(args.path, 'utf8').replace(
          /const _cb\s*=\s*`[^`]*`\s*;/,
          'const _cb = "";'
        );
        return { contents, loader: 'js' };
      });
    }
  }]
});

console.log('bundle.js built successfully');
