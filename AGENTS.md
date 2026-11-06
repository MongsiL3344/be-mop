## Team lead approval required
If the current branch (`git status`) is `mong`, the user is the team lead: this section does not apply, and the Git section does not apply either, except one rule: you still never run `git commit`, `git push`, or any command that rewrites history yourself; the team lead runs them.
Otherwise, stop, explain what you need and why, and wait until the user confirms the team lead approved it. Do not proceed on your own judgment. The following always require approval:
- Importing from another feature's folder (`src/features/<other>/`). If importing something from another feature would make your work easier, do not import it on your own: tell the user what you want to import and why, and have them agree on that integration with the team lead. If approved, import only that.
- Editing a file in another feature's folder, in `src/lib/`, or another feature's `prisma/schema/<other>.prisma`; editing `prisma/schema/schema.prisma` (generator/datasource) at all. Editing `src/app.ts` for anything other than mounting your feature's router, or editing `src/index.ts` at all (see Project structure).
  - Exception (no approval needed): when your model adds a relation to another feature's model, add the one required back-relation field line to that model (e.g. `schedules Schedule[]` in `User`). Add it by hand (never `prisma format`), change nothing else in that file, and keep the foreign key column and `@relation` on your own model's side.
- Adding or removing a dependency in `package.json`.
- Editing config files: `package.json` scripts, `tsconfig.json`, `tsconfig.build.json`, `prisma.config.ts`, `compose.yaml`, `Dockerfile`.
- `AGENTS.md` itself: never edit it. Not even with approval; only the team lead changes it on `mong`.

## Git
- The only working branch is `park`. Never create or switch branches.
- Before any work, run `git status` to check the current branch. If it is not `park`, do no work: tell the user to run `git switch park` and wait until the user confirms the branch changed.
- After confirming the branch, run `git pull origin dev`. On a conflict, do not touch any file: stop, show the user the list of conflicting files, and hand it to the team lead.
- You may run read-only commands (`git status`, `git diff`, `git log`) and `git pull origin dev` yourself.
- Never run `git commit`, `git push`, or any command that rewrites history. When work is ready, tell the user which files changed and show only these commands: `git add .`, `git commit -m "<type>: <message>"`, `git push origin park`.
- Commit message format: one line, `<type>: <message>`, no body and no scope. `<type>` is one of `feat` (new feature), `fix` (bug fix), `test` (tests only), `refactor` (no behavior change), `setup` (project/environment setup), `chore` (other maintenance). `<message>` is a short Korean summary, e.g. `feat: 로그인 구현`.
- The only git commands you may show are exactly these: `git status`, `git switch park`, `git pull origin dev`, `git add .`, `git commit -m "<message>"`, `git commit --amend -m "<message>"`, `git push origin park`. Never show any other command or flag (`-A`, `--force`, `rebase`, `stash`, `reset`, `worktree`, ...). If the situation seems to need one, describe the situation and hand it to the team lead.
- `git commit --amend -m "<message>"` is only for fixing the message of the latest commit, and only if that commit has not been pushed yet (check with `git log origin/park..park`; it must list the commit). Once pushed, never amend; tell the user to make a new commit instead.
- `main` is for deployment and `dev` is for integration. Never push to either. Changes reach `dev` through a `park → dev` pull request on GitHub; the team lead merges it.

## Formatting
- Do not run Prettier or any formatter. Do not reformat code you did not change.
- Match the surrounding style: 2-space indent, double quotes, semicolons.

## Docker
- `compose.yaml` is development-only. Inside the `api` container `DATABASE_URL`, `TEST_DATABASE_URL` and `PORT` come from `compose.yaml`, not `.env`.
- Run the databases (`db`, `db-test`) with `docker compose`. Commands (`npx tsc`, `npx vitest`, `npx prisma`) may run on the host (WSL) or inside the `api` container. On the host they read `.env`, so `DATABASE_URL` is the development DB and `.env` must define `TEST_DATABASE_URL`.
- Start everything with `docker compose up`; on start the `api` container applies pending migrations (`prisma migrate deploy`) and regenerates the Prisma client. After pulling `dev`, or whenever `package.json` changed, use `docker compose up --build -V` instead (`-V` recreates the `node_modules` volume; without it the old modules are reused). If you run commands on the host, also run `npm ci` then (it installs exactly what `package-lock.json` lists and changes no files; allowed without approval, unlike adding or removing a dependency).

## Verification
- After every code change, run `npx tsc --noEmit` (checks `src/` and `tests/`) and `npx vitest run tests/<feature>` (on the host or in the container). Work is not done while either reports errors or failures.
- Never silence a type error with `any`, a type cast (`as`), `!`, `@ts-ignore`, or `@ts-expect-error`. If you cannot fix it properly, show the error as-is and stop.
- If a command itself fails (database not running, module not found), do not install anything beyond the `npm ci` sync described under Docker; show the error to the user.

## Testing
- Tests use vitest + supertest against the real test Postgres (`db-test` in `compose.yaml`, reached via `TEST_DATABASE_URL`). No Prisma mocks. Each `it` asserts both the HTTP response and the DB state.
- Put tests in `tests/<feature>/` and run only your own: `npx vitest run tests/<feature>`. Never edit another feature's test folder.
- `vitest.config.ts` swaps `DATABASE_URL` for `TEST_DATABASE_URL` before any test loads, so the app code always hits the test DB; do not add test-only branches to `src/`. `vitest.setup.ts` applies `prisma migrate deploy` to the test DB once per run; tests do not run migrations themselves.
- Request through the exported `app` (`import { app } from "../../src/app.js"`) with supertest; never `listen`. Query the DB through the shared `prisma` from `src/lib/db.ts`.
- Each `it` starts from a clean state: in `beforeEach`, `TRUNCATE TABLE "<T1>", "<T2>" RESTART IDENTITY CASCADE` the tables your feature touches via `prisma.$executeRawUnsafe`, then create your own data. No order dependence between tests, no `it.skip`/`it.todo`/`only`. Call `prisma.$disconnect()` in `afterAll`.

## Project structure (feature modules)
- `src/features/<feature>/` holds one feature: `controller.ts` (Express router: parse request, call service, send response) and `service.ts` (business logic, calls Prisma directly) as flat files, plus a `dto/` folder for zod schemas and their inferred types (file names inside `dto/` are up to you). Add a flat `repository.ts` only when a feature accumulates complex queries. `dto/` is the only subfolder; do not create others.
- `src/lib/` holds shared code: `db.ts` (`prisma` client), `socket.ts` (`io`), `errors.ts` (`httpError`, `errorHandler`). Import these; never create another `PrismaClient` or socket.io `Server`.
- `src/app.ts` builds the express `app` (middleware, feature routers, `errorHandler`) and exports it for tests; `src/index.ts` only creates the http server, attaches socket.io, and listens. Mount your feature's router with one `app.use(...)` line placed above `app.use(errorHandler)`. Never export anything from `src/index.ts` (circular import).
- Work on one feature at a time. Code that several features genuinely share belongs in `src/lib/` (approval required, see above).

## Code rules
- Validate every request body, query, and params with `schema.parse(...)` before use; define that zod schema in a DTO file inside your feature's `dto/` folder. Never read `req.body` fields directly. Do not use `safeParse`; a thrown `ZodError` becomes a 400 automatically.
- Error handling: in `service.ts` throw `httpError(status, "message")` from `src/lib/errors.ts`. Do not `try/catch` in controllers; `errorHandler` turns `ZodError` into 400, `httpError` into its status, and anything else into 500.
- Schema changes: models live in `prisma/schema/<feature>.prisma`, one file per feature (Prisma reads the whole folder; relations across files work). Create or edit only your own file, except the back-relation line allowed under Team lead approval required. Name each migration `<feature>_<description>` in snake_case (e.g. `npx prisma migrate dev --name user_add_user` → `prisma/migrations/<timestamp>_user_add_user/`). Commit your `.prisma` file and the new `prisma/migrations/<folder>/` in the same commit as the feature code. Never edit a committed `migration.sql`; fix the schema and create another migration. Exception on `mong` only: a migration whose commit has not been pushed yet (`git log origin/mong..mong` lists it) may be edited or merged into one migration. Never run `prisma db push`.
- Code comments and commit messages are written in Korean.
- Never hardcode secrets or connection strings. Read them from `process.env`. When adding a new environment variable, add it to `.env.example` with a placeholder value.
- Implement only what the user asked for. Do not add features, options, or refactors that were not requested. If you notice something else that seems needed, do not do it; list it as a suggestion when you finish.
