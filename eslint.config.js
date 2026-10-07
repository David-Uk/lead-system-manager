export default [
  {
    ignores: ["node_modules/**", "coverage/**", "logs/**", ".vercel/**", ".vercel-tmp/**"]
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        AbortController: "readonly",
        fetch: "readonly",
        Response: "readonly"
      }
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],
      "no-undef": "error"
    }
  },
  {
    files: ["dashboard/**/*.js", "home/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        sessionStorage: "readonly"
      }
    }
  }
];
