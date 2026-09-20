# Before you commit

## Branching

`dev` is the main branch — everything ships from it, and it's the only branch on
the remote. `master` is an old abandoned line; ignore it.

Work never starts on `dev` itself: cut a branch for the change
(`feature/<name>` for new work, `fix/<name>` for fixes), commit there, then
merge it into `dev` and push `dev`.

## Checklist

1. **Docs are current** — `CLAUDE.md` (and the per-directory ones under `src/`),
   `README.md`, `DEV.md`, `DEPLOY.md` and `src/db/CLAUDE.md` describe the code as
   it now is. A behaviour change that isn't reflected in them isn't finished.
2. **Docs and comments are exact** — no claim that the code doesn't back:
   real file paths, real function names, real SQL, real error strings.
3. **Docs and comments are brief** — say it once, in as few words as it takes.
   Drop anything the code already says plainly.
4. **No duplicates** — one home per fact. Cross-reference the other doc instead
   of restating it (entity/behaviour overview in `CLAUDE.md`, schema in
   `src/db/CLAUDE.md`, actions in `src/actions/CLAUDE.md`, components in
   `src/components/CLAUDE.md`, filters in `src/lib/CLAUDE.md`).
5. **Changelog** — a feature, behaviour change or migration gets a `VERSIONS.md`
   entry and a `version` bump in `package.json`.
6. **Issues** — a fixed audit finding moves from `TO_FIX.md` to `FIXED.md` under
   today's date with a short **Fix:** note.
7. **Green** — `npm test`, `npx tsc --noEmit` and `npm run lint` pass.
