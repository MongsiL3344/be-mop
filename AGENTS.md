## Team lead approval required
Stop, explain what you need and why, and wait until the user confirms the team lead approved it. Do not proceed on your own judgment. The following always require approval:
If the current branch (`git status`) is `mong`, the user is the team lead: this section does not apply, and the `park`-only rules in the Git section do not apply either.
- Importing from another feature's folder (`src/features/<other>/`). If approved, import only that.
- Editing a file in another feature's folder, in `src/lib/`, in `src/index.ts`, or a model in `prisma/schema.prisma` owned by another feature.
- Adding or removing a dependency in `package.json`.
- Editing config files: `package.json` scripts, `tsconfig.json`, `prisma.config.ts`, `compose.yaml`, `Dockerfile`.
- `AGENTS.md` itself: never edit it. Not even with approval; only the team lead changes it on `mong`.

## Git
- The only working branch is `park`. Never create or switch branches.
- Before any work, run `git status` to check the current branch. If it is not `park`, do no work: tell the user to run `git switch park` and wait until the user confirms the branch changed.
- After confirming the branch, run `git pull origin dev`. On a conflict, do not touch any file: stop, show the user the list of conflicting files, and hand it to the team lead.
- You may run read-only commands (`git status`, `git diff`, `git log`) and `git pull origin dev` yourself.
- Never run `git commit`, `git push`, or any command that rewrites history. When work is ready, tell the user which files changed and show only these commands: `git add <file>` (only the files you changed; never `git add .`), `git commit -m "<feature>: <message>"`, `git push origin park`.
- The only git commands you may show are exactly these: `git status`, `git switch park`, `git pull origin dev`, `git add <file>`, `git commit -m "<message>"`, `git commit --amend -m "<message>"`, `git push origin park`. Never show any other command or flag (`-A`, `--force`, `rebase`, `stash`, `reset`, `worktree`, ...). If the situation seems to need one, describe the situation and hand it to the team lead.
- `git commit --amend -m "<message>"` is only for fixing the message of the latest commit, and only if that commit has not been pushed yet (check with `git log origin/park..park`; it must list the commit). Once pushed, never amend; tell the user to make a new commit instead.
- `main` is for deployment and `dev` is for integration. Never push to either. Changes reach `dev` through a `park → dev` pull request on GitHub; the team lead merges it.

## Formatting
- Do not run Prettier or any formatter. Do not reformat code you did not change.
- Match the surrounding style: 2-space indent, double quotes, semicolons.

## Docker
- `compose.yaml` is development-only. Inside the `api` container `DATABASE_URL` and `PORT` come from `compose.yaml`, not `.env`.
- Run Prisma commands inside the container: `docker compose exec api npx prisma ...`.
- After changing `package.json`, rebuild with `docker compose up --build`.

## Verification
- After every code change, run `docker compose exec api npx tsc --noEmit` and paste the result to the user. Work is not done while it reports errors.
- Never silence a type error with `any`, a type cast (`as`), `!`, `@ts-ignore`, or `@ts-expect-error`. If you cannot fix it properly, show the error as-is and stop.
- If the command itself fails (container not running, module not found), do not install anything or run `tsc` on the host; show the error to the user.

## Project structure (feature modules)
- `src/features/<feature>/` holds one feature as flat files: `controller.ts` (Express router: parse request, call service, send response), `service.ts` (business logic, calls Prisma directly), `schema.ts` (zod schemas and their inferred types). Add a `repository.ts` only when a feature accumulates complex queries; do not create subfolders.
- `src/lib/` holds code shared by several features (db client, session helpers). `src/index.ts` only wires middleware and mounts feature routers.
- Work on one feature at a time. Code that several features genuinely share belongs in `src/lib/` (approval required, see above).

## Code rules
- Validate every request body, query, and params with a zod schema from `schema.ts` before use. Never read `req.body` fields directly.
- Never hardcode secrets or connection strings. Read them from `process.env`. When adding a new environment variable, add it to `.env.example` with a placeholder value.
- Implement only what the user asked for. Do not add features, options, or refactors that were not requested. If you notice something else that seems needed, do not do it; list it as a suggestion when you finish.
