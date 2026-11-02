## Team lead approval required
Stop, explain what you need and why, and wait until the user confirms the team lead approved it. Do not proceed on your own judgment. The following always require approval:
If the current branch (`git status`) is `mong`, the user is the team lead: this section does not apply, and the `park`-only rules in the Git section do not apply either.
- Importing from another feature's folder (`src/features/<other>/`). If approved, import only that.
- Editing a file in another feature's folder, in `src/lib/`, or another feature's `prisma/schema/<other>.prisma`; editing `prisma/schema/schema.prisma` (generator/datasource) at all. Editing `src/app.ts` for anything other than mounting your feature's router, or editing `src/index.ts` at all (see Project structure).
- Adding or removing a dependency in `package.json`.
- Editing config files: `package.json` scripts, `tsconfig.json`, `prisma.config.ts`, `compose.yaml`, `Dockerfile`.
- `AGENTS.md` itself: never edit it. Not even with approval; only the team lead changes it on `mong`.

## Git
- The only working branch is `park`. Never create or switch branches.
- Before any work, run `git status` to check the current branch. If it is not `park`, do no work: tell the user to run `git switch park` and wait until the user confirms the branch changed.
- After confirming the branch, run `git pull origin dev`. On a conflict, do not touch any file: stop, show the user the list of conflicting files, and hand it to the team lead.
- You may run read-only commands (`git status`, `git diff`, `git log`) and `git pull origin dev` yourself.
- Never run `git commit`, `git push`, or any command that rewrites history. When work is ready, tell the user which files changed and show only these commands: `git add .`, `git commit -m "<feature>: <message>"`, `git push origin park`.
- The only git commands you may show are exactly these: `git status`, `git switch park`, `git pull origin dev`, `git add .`, `git commit -m "<message>"`, `git commit --amend -m "<message>"`, `git push origin park`. Never show any other command or flag (`-A`, `--force`, `rebase`, `stash`, `reset`, `worktree`, ...). If the situation seems to need one, describe the situation and hand it to the team lead.
- `git commit --amend -m "<message>"` is only for fixing the message of the latest commit, and only if that commit has not been pushed yet (check with `git log origin/park..park`; it must list the commit). Once pushed, never amend; tell the user to make a new commit instead.
- `main` is for deployment and `dev` is for integration. Never push to either. Changes reach `dev` through a `park → dev` pull request on GitHub; the team lead merges it.

## Formatting
- Do not run Prettier or any formatter. Do not reformat code you did not change.
- Match the surrounding style: 2-space indent, double quotes, semicolons.

## Docker
- `compose.yaml` is development-only. Inside the `api` container `DATABASE_URL`, `TEST_DATABASE_URL` and `PORT` come from `compose.yaml`, not `.env`.
- Run Prisma commands inside the container: `docker compose exec api npx prisma ...`.
- Start everything with `docker compose up`; on start the `api` container applies pending migrations (`prisma migrate deploy`) and regenerates the Prisma client. After pulling `dev`, or whenever `package.json` changed, use `docker compose up --build -V` instead (`-V` recreates the `node_modules` volume; without it the old modules are reused).

## Verification
- After every code change, run `docker compose exec api npx tsc --noEmit` and `docker compose exec api npx vitest run tests/<feature>` and paste both results to the user. Work is not done while either reports errors or failures.
- Never silence a type error with `any`, a type cast (`as`), `!`, `@ts-ignore`, or `@ts-expect-error`. If you cannot fix it properly, show the error as-is and stop.
- If a command itself fails (container not running, module not found), do not install anything or run it on the host; show the error to the user.

## Testing
- Tests use vitest + supertest against the real test Postgres (`db-test` in `compose.yaml`, reached via `TEST_DATABASE_URL`). No Prisma mocks. Each `it` asserts both the HTTP response and the DB state.
- Put tests in `tests/<feature>/` and run only your own: `docker compose exec api npx vitest run tests/<feature>`. Never edit another feature's test folder.
- `vitest.config.ts` swaps `DATABASE_URL` for `TEST_DATABASE_URL` before any test loads, so the app code always hits the test DB; do not add test-only branches to `src/`. `vitest.setup.ts` applies `prisma migrate deploy` to the test DB once per run; tests do not run migrations themselves.
- Request through the exported `app` (`import { app } from "../../src/app.js"`) with supertest; never `listen`. Query the DB through the shared `prisma` from `src/lib/db.ts`.
- Each `it` starts from a clean state: in `beforeEach`, `TRUNCATE TABLE "<T1>", "<T2>" RESTART IDENTITY CASCADE` the tables your feature touches via `prisma.$executeRawUnsafe`, then create your own data. No order dependence between tests, no `it.skip`/`it.todo`/`only`. Call `prisma.$disconnect()` in `afterAll`.

## Project structure (feature modules)
- `src/features/<feature>/` holds one feature as flat files: `controller.ts` (Express router: parse request, call service, send response), `service.ts` (business logic, calls Prisma directly), `schema.ts` (zod schemas and their inferred types). Add a `repository.ts` only when a feature accumulates complex queries; do not create subfolders.
- `src/lib/` holds shared code: `db.ts` (`prisma` client), `socket.ts` (`io`), `errors.ts` (`httpError`, `errorHandler`). Import these; never create another `PrismaClient` or socket.io `Server`.
- `src/app.ts` builds the express `app` (middleware, feature routers, `errorHandler`) and exports it for tests; `src/index.ts` only creates the http server, attaches socket.io, and listens. Mounting your own router (one `app.use("/<feature>", <feature>Router)` line in `src/app.ts`) is allowed without approval; mount it above `app.use(errorHandler)`. Never export anything from `src/index.ts` (circular import).
- Work on one feature at a time. Code that several features genuinely share belongs in `src/lib/` (approval required, see above).

## Code rules
- Validate every request body, query, and params with `schema.parse(...)` using a zod schema from `schema.ts` before use. Never read `req.body` fields directly. Do not use `safeParse`; a thrown `ZodError` becomes a 400 automatically.
- Error handling: in `service.ts` throw `httpError(status, "message")` from `src/lib/errors.ts`. Do not `try/catch` in controllers; `errorHandler` turns `ZodError` into 400, `httpError` into its status, and anything else into 500.
- Schema changes: models live in `prisma/schema/<feature>.prisma`, one file per feature (Prisma reads the whole folder; relations across files work). Create or edit only your own file, run `docker compose exec api npx prisma migrate dev --name <feature>_<description>` (e.g. `auth_add_user`), then `docker compose restart api` so the client is regenerated. Commit your `.prisma` file and the new `prisma/migrations/<folder>/` in the same commit as the feature code. Never edit a committed `migration.sql`; fix the schema and create another migration. Never run `prisma db push` or `prisma migrate reset`.
- Code comments and commit messages are written in Korean.
- Never hardcode secrets or connection strings. Read them from `process.env`. When adding a new environment variable, add it to `.env.example` with a placeholder value.
- Implement only what the user asked for. Do not add features, options, or refactors that were not requested. If you notice something else that seems needed, do not do it; list it as a suggestion when you finish.
