// Focused ESLint setup — ONE custom rule, intentionally NOT a full lint adoption
// (no eslint-config-next), so it won't flood the build with unrelated style
// errors. Its only job: trip on the RSC bug class that tsc/next build miss.
//
// The bug: a Server Component (a module WITHOUT "use client") importing a
// non-component VALUE (constant/array/object) from a "use client" module. Next
// turns that into a client-reference proxy at runtime, not the value, so
// `THE_VALUE.map(...)` throws and 500s the page on every render — yet tsc AND
// next build pass. See memory: rsc-client-value-import-2026-05-28.

import tsParser from "@typescript-eslint/parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Cache use-client checks per resolved file path (lint touches the same target
// modules repeatedly).
const useClientCache = new Map();

function hasUseClientDirective(filePath) {
  if (useClientCache.has(filePath)) return useClientCache.get(filePath);
  let result = false;
  try {
    let src = fs.readFileSync(filePath, "utf8");
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // strip BOM
    // Skip leading whitespace + comments, then require the FIRST real token to
    // be the directive. Char-scanning (not regex) so a comment that merely
    // MENTIONS "use client" can't be mistaken for the directive.
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
      if (c === "/" && src[i + 1] === "/") {
        const nl = src.indexOf("\n", i + 2);
        if (nl === -1) break;
        i = nl + 1; continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end === -1) break;
        i = end + 2; continue;
      }
      result = /^['"]use client['"]/.test(src.slice(i, i + 14));
      break;
    }
  } catch {
    result = false;
  }
  useClientCache.set(filePath, result);
  return result;
}

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith("@/")) base = path.resolve(PROJECT_ROOT, spec.slice(2));
  else return null; // bare package import — not our concern
  const candidates = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
  for (const ext of candidates) {
    const p = base + ext;
    try { if (fs.statSync(p).isFile()) return p; } catch { /* try next */ }
  }
  return null;
}

const noClientValueImports = {
  meta: {
    type: "problem",
    docs: { description: "Disallow importing non-component values from a \"use client\" module into a server module." },
    schema: [],
    messages: {
      valueFromClient:
        "'{{name}}' is a value imported from a \"use client\" module ({{source}}). In a Server Component this resolves to a client-reference proxy at runtime — NOT the value — so it crashes (e.g. \".map is not a function\") and tsc/next build won't catch it. Move shared constants/helpers/types to a plain (non-client) module and import from there.",
    },
  },
  create(context) {
    const currentFile = context.filename ?? context.getFilename();
    // Only server (non-client) modules are affected. Client→client value
    // imports are fine.
    if (hasUseClientDirective(currentFile)) return {};
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return; // `import type { ... } from`
        const target = resolveImport(currentFile, node.source.value);
        if (!target || !hasUseClientDirective(target)) return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue; // skip default + namespace
          if (spec.importKind === "type") continue; // `import { type X }`
          const name = spec.imported.name;
          // PascalCase WITH a lowercase letter = a React component, which is
          // safe to import into a Server Component (Next passes it as a
          // reference and renders it as JSX). Anything else (UPPER_SNAKE,
          // camelCase) is a runtime value → flag it.
          const isComponent = /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
          if (!isComponent) {
            context.report({ node: spec, messageId: "valueFromClient", data: { name, source: node.source.value } });
          }
        }
      },
    };
  },
};

// No-op stub so pre-existing `// eslint-disable-next-line @next/next/...`
// comments resolve to a known rule name. We intentionally do NOT pull
// eslint-config-next (it would flood the build with unrelated style errors on a
// never-linted codebase); this only defines the names so legacy directives
// don't error.
const nextNoopRule = { meta: { schema: [] }, create: () => ({}) };
const nextPluginStub = { rules: { "no-img-element": nextNoopRule } };

export default [
  { ignores: ["node_modules/**", ".next/**", "next-env.d.ts", "public/**"] },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    // Don't flag the codebase's existing eslint-disable comments (e.g.
    // no-console) as "unused" — they're not our concern; we only enforce the
    // RSC rule below.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: {
      rsc: { rules: { "no-client-value-imports": noClientValueImports } },
      "@next/next": nextPluginStub,
    },
    rules: { "rsc/no-client-value-imports": "error" },
  },
];
