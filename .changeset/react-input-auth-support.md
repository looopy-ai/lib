---
"@looopy-ai/react": minor
---

Add input-required and auth-required support to the React UI

- New `InputRequiredTurn` and `AuthRequiredTurn` types in `Conversation`
- `InputRequiredPrompt` component with four input modes: confirmation, clarification, selection, and data
- `AuthRequiredPrompt` component supporting oauth2, api-key, pat, password, and custom auth flows
- SSE event reducers for `input-required`, `input-received`, `auth-required`, and `auth-completed`
- Storybook stories with all variants and interactive demos
- Vitest + @testing-library/react component tests and reducer unit tests (45 tests total)
