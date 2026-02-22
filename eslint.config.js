import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  ...svelte.configs["flat/prettier"], // 建议也加上这个，确保 svelte 文件和 prettier 配合良好
  prettier,
  {
    // 关键配置：针对 TypeScript 文件和 Svelte 文件中的脚本
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        // 如果你使用了项目范围的类型检查，可以取消下面注释
        // project: true,
        // extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    // 专门为 Svelte 文件配置 TS 解析器
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser, // 在 svelte 中使用 ts 解析器
      },
    },
  },
  {
    ignores: ["build/", ".svelte-kit/", "dist/", "drizzle/"],
  },
];
