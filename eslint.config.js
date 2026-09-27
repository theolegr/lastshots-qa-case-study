import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated output, not source. `coverage/` in particular ships bundled
  // vendor JS that lints noisily and would drown the real findings.
  { ignores: ["dist", "coverage", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // The data layer may not assert its own types.
  //
  // `api.ts` used to declare five row interfaces by hand and end every query
  // with `return data as Party`. Twice that assertion was wrong and no layer
  // could disagree: `Situation.emoji` was declared non-nullable against a
  // genuinely NULL column, and `Party` declared `max_votes` while
  // `get_party_by_code` did not return it — the second reached production and
  // survived a full CI cycle. Enabling `strict` caught neither and could not,
  // because a cast outranks every compiler flag. The casts are gone and the
  // types derive from the generated schema (`dbContracts.ts`); this rule is
  // what stops the next one being written.
  //
  // Scoped to `src/lib` and `src/hooks` — where rows enter the app — rather
  // than all of `src`. The assertions left in `src/pages` and
  // `src/components` are a different class: three `(error as Error).name`
  // reads in `catch` blocks and one index into a lookup table. Banning those
  // would mean rewriting error handling in the share flow to satisfy a lint
  // rule, which is the tail wagging the dog.
  //
  // The five realtime handlers that used to do `payload.new as Party` now go
  // through `partyFromRealtime` / `participantFromRealtime`: a `postgres_changes`
  // payload has no generated type underneath it, so the cast invented a
  // guarantee nothing checked. The second rule below is what stops them coming back.
  {
    files: ["src/lib/**/*.ts", "src/hooks/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
    },
  },

  // No file in `src` may assert a value *into* a database row type.
  //
  // The blanket ban above cannot reach `src/pages` and `src/components`, which
  // hold four legitimate assertions of a different class — `(error as Error)`
  // inside `catch` blocks, and one lookup-table index. But the row-cast class
  // lived there too: five realtime handlers wrote `payload.new as Party` on a
  // `postgres_changes` payload that has no generated type underneath it, and
  // `Party.status` is narrowed to the CHECK constraint's three values, so the
  // assertion invented a guarantee. They now go through the validating
  // `partyFromRealtime` / `participantFromRealtime`.
  //
  // This rule bans the shape by name rather than banning assertions wholesale,
  // so `as Error` stays legal and `as Party`, `as Party[]`, `as Party | null`
  // and `as ParticipantType` do not. Verified by reintroducing one.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression TSTypeReference > Identifier[name=/^(Party|Participant|Situation|Photo|Vote|CreatedParty)/]",
          message:
            "Do not assert a value into a database row type. Rows come from the generated schema (src/lib/dbContracts.ts); validate untyped payloads with toParty / parseCreatePartyPayload / partyFromRealtime instead. See ARCHITECTURE.md, 'Core Logic'.",
        },
      ],
    },
  },
);
