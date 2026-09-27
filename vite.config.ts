import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "Last Shots - Capture the Chaos",
        short_name: "Last Shots",
        description: "5 shots. 5 situations. 1 epic night. The ultimate party photo game.",
        theme_color: "#1a1a2e",
        background_color: "#0f0f1a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      // `json-summary` is what `scripts/record-metrics.mjs` reads. Without it
      // the coverage figure exists only inside an HTML report, which means the
      // history file cannot record the one number CI already enforces.
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",

      // Scoped to the pure-logic modules on purpose — this number measures the
      // unit tier, not the product.
      //
      // Pointing it at `src/**` would report a percentage in the single digits
      // and mean nothing: the rest of `src/` is React components and pages
      // whose behaviour is covered by the Playwright suite, which v8 coverage
      // here cannot observe. A repo-wide figure would understate the real
      // coverage while looking rigorous, which is the worst of both. The
      // honest claim is narrow: *the extracted business rules are fully
      // covered by fast tests.*
      include: ["src/lib/**/*.ts"],

      exclude: [
        // The I/O boundary. It cannot even be imported by a unit test (it pulls
        // the Supabase client, which reads `localStorage` at module scope), and
        // every rule that used to live in it has been extracted to a module
        // that *is* covered here. What remains is thin query-and-return code,
        // exercised against a real database by the E2E suite.
        "src/lib/api.ts",
        // A single `import.meta.env.DEV` constant — nothing to execute.
        "src/lib/devTools.ts",
      ],

      // Enforced, not decorative. These modules are pure functions with no
      // branches that depend on the environment, so anything less than full
      // coverage means a rule shipped without a test.
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
}));
