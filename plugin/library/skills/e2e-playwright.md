---
name: e2e-playwright
triggers: [playwright, e2e, flaky test, browser test, page object, browser automation]
source: alirezarezvani/claude-skills · engineering-team/playwright-pro/skills/pw/SKILL.md @19392f7 · MIT
---
# End-to-end tests with Playwright

A browser test that passes today and fails on Tuesday teaches the team to ignore red. Most of that flakiness comes from three habits.

**Locate like a user.** `getByRole` first, then `getByLabel`, `getByText`, `getByTestId`, and CSS only when nothing semantic exists. A role locator survives a restyle and fails loudly when the accessible name is missing.

**Assert on the locator, not a snapshot of it.** `expect(locator).toBeVisible()` retries until timeout; `expect(await locator.textContent())` checks once and races the render. Never `waitForTimeout`, never `networkidle`; after a click that navigates, assert `toHaveURL` before asserting content. Give every flow one error path by fulfilling the API route with a 500.

**Isolate every test.** Each test creates its own data through the API or a fixture; share setup through `test.extend`, not module variables, and log in once into `storageState`. Mock third parties only; mocking your own app tests the mock. In config: `baseURL`, retries 2 in CI and 0 locally, trace on first retry.

**Diagnose flakiness by where it fails.** Fails locally under `--repeat-each=20`: timing, so find the missing `await`. Passes alone, fails in the suite: isolation, so find the shared state. Fails only in CI: environment, so fix viewport, fonts or timezone. Otherwise infrastructure; reduce workers. A fix counts at ten passes of ten.

The full source, with templates and the anti-pattern list: `vibekit skills reference e2e-playwright`.
