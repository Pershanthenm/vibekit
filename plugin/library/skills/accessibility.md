---
name: accessibility
triggers: [accessibility, a11y, wcag, screen reader, color contrast, keyboard navigation]
source: alirezarezvani/claude-skills · engineering-team/a11y-audit/skills/a11y-audit/SKILL.md @19392f7 · MIT
---
# Accessibility audit and repair

Scan, fix, verify, and sort by who is locked out. Critical means a whole group cannot proceed: an image with no alt, a `div` with `onClick` that a keyboard cannot reach, a modal that swallows focus. Fix them before release. Major degrades the experience (contrast under the ratio, an input with only a placeholder); fix in the sprint. Minor is friction (redundant ARIA, a skipped heading level); schedule it.

**Prefer the native element to ARIA.** A `button` has keyboard handling, focus and a role for free; `role="button"` on a `div` has none until someone adds each by hand. Label fields with a visible `label`, not a placeholder that vanishes on typing. When the label is visible text, point at it with `aria-labelledby`. Hide from sighted users with an `sr-only` class; `display: none` hides from everyone.

**Numbers to check.** Text contrast 4.5:1, large text and UI components 3:1. Focus indicator at least a 2px outline with 3:1 against its surroundings, and no `outline: none`. Interactive targets at least 24px. Never carry meaning in colour alone.

**Then use it.** Tab through every control in reading order, close each dialog with Escape and confirm focus returns to what opened it, and hear the page once with a screen reader: errors should announce through `role="alert"` and headings should outline the page in order. Re-scan against the baseline afterwards.

The full source, with WCAG 2.2 criteria and per-framework fixes: `vibekit skills reference accessibility`.
