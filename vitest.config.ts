import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile();
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
process.env["DATABASE_URL"] = testDatabaseUrl;

export default defineConfig({
  test: { globalSetup: ["./vitest.setup.ts"] },
});
