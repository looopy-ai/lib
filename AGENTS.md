For any changes, please generate `changeset` compatible change files in `./.changeset/{id}.md`. The id can be anything unique.

Contents should look something like.

```
---
"@looopy-ai/aws": patch
"@looopy-ai/core": minor
"@looopy-ai/react": major
---

Description of change
```

In the header, only list packages affected by this change and indicate the semantic version level of the change "patch|minor|major".

## File naming convention

All source files must use **kebab-case** filenames (e.g. `my-component.tsx`, `my-component.test.tsx`, `my-component.stories.tsx`). PascalCase or camelCase filenames are not allowed.
