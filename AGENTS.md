# AGENTS.md

## General

- Never modify files outside the scope of the task
- Don't create files unless explicitly asked or clearly necessary
- Always use current, non-deprecated APIs and patterns for every library
- No commented-out code (dead/disabled code); comments must explain _why_, not _what_
- Place functions used across multiple files in `lib/utils.ts`; keep functions used in only one file co-located in that file

## Naming

- Booleans prefixed with `is`, `has`, or `can`
- Event handlers prefixed with `handle`; use `on` only for prop names
- DB table names and columns in `snake_case`; TS types/vars in `camelCase`

## TypeScript

- Use `type`, never `interface`
- Never use `any`; use `unknown` and narrow it
- Don't use `as` to silence type errors — fix the type
- Use `function` declarations for named, top-level functions; use arrow functions for inline callbacks (e.g. `.map()`, `.filter()`) and JSX event handlers

## Validation

- Use Zod v4 for all validation
- Never trust raw input — every procedure and form must have a Zod schema
- When adding a new env var, add it to the Zod env schema, don't access process.env directly
