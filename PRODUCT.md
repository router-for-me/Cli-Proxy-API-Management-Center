# Product

## Register

product

## Users

CLI Proxy API operators managing backend connections, provider credentials, quota, routing and configuration. In quota settings, their task is to identify the affected account and decide whether applications may consume its Credit balance after the included allowance runs out.

## Product Purpose

Provide a React management frontend for the backend v8 Management API. Account changes should be explicit, attributable to the selected account and accurately confirmed.

## Brand Personality

Follow the existing management interface: clear, restrained and actionable. Use familiar product terms and preserve the existing components and theme tokens.

## Anti-references

- Routine dialogs explaining internal endpoints, token substitution, cache lifetime or routing implementation.
- Repeated warning panels competing with the actual operation result.
- Last-confirmed observations presented as freshly queried account state.

## Design Principles

1. Disclose spending consequences and the affected account/application scope before the user confirms a change.
2. Keep information needed for the decision visible. Show recovery guidance only for the state that requires it.
3. Explain outcomes and next actions in user language; keep implementation details in developer documentation and diagnostic tools.
4. Do not invent certainty. Distinguish an unknown setting, a confirmed result and an unconfirmed update.
5. Reuse shared controls, interaction patterns and terminology instead of introducing feature-specific primitives.

## Accessibility & Inclusion

Preserve keyboard operation, safe initial focus, focus restoration, accessible names and reduced-motion behavior. Maintain readable contrast and wrapping across all seven supported languages and narrow layouts.
