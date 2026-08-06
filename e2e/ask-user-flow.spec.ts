import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, typeIntoField, clickSelector, clickByText } from "./helpers";

// The only other real-provider-call spec besides chat-flow.spec.ts — see its file comment for the
// cost/provider rationale (E2E_PROVIDER=openrouter for cheap-model runs). This one exercises the
// ask_user tool: Cipher's agent-creation flow is prompt-engineered (configAgent.md) to gather
// domain-essential facts one question at a time via ask_user rather than bundling them into reply
// text, which is exactly the bug this whole feature was built to fix.
//
// Q&A is deliberately never persisted to the messages table (see the plan's "live card only"
// decision) — there's no DB row to poll for the question itself, only the DOM card that
// AgentsApp.tsx renders from the agent:stream-question IPC push. And since how many questions a
// live model asks, and in what order, isn't something this test controls, this spec only proves
// the structural mechanism: a question card appears, answering it resumes the run (the card either
// clears or is replaced by the next one), never asserting exact question wording or a fixed count.

const provider = resolveE2EProvider();

test.describe("ask_user flow", () => {
  test.setTimeout(120_000);

  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    const { userData } = launchSandboxedApp();
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("Cipher asks one question at a time via a real ask_user card, and answering it resumes the run", async () => {
    await typeIntoField(
      page,
      "#inp",
      "I want a new agent to track my daily workouts. Ask me whatever you need to set it up."
    );
    await page.keyboard.press("Enter");

    // Structural DOM signal, not DB — see file comment. Generous timeout: this is a second real
    // model round trip (orchestrator routing hop, then Cipher's own turn) on top of chat-flow's
    // already-tight defaults.
    await page.waitForSelector(".ask-user-card", { timeout: 90_000 });

    const questionBefore = await page.textContent(".ask-user-card-question");
    expect(questionBefore, "ask_user card rendered with no question text").toBeTruthy();

    // Answer via whichever field type the model actually chose — text input or a single_select
    // option — rather than assuming one, since that's a live model's call to make.
    const hasTextInput = (await page.$(".ask-user-card input[type='text']")) !== null;
    if (hasTextInput) {
      await typeIntoField(page, ".ask-user-card input[type='text']", "No injuries, goal is general fitness");
      await clickByText(page, "Answer", ".ask-user-card");
    } else {
      await clickSelector(page, ".ask-user-card-option");
    }

    // Proof the pause/resume mechanism actually works end-to-end: either the card clears (run
    // finished or moved past questions) or is replaced with the next question — both mean the
    // agent run picked back up after the answer, which is the only thing this spec needs to prove.
    await page.waitForFunction(
      (prevQuestion) => {
        const card = document.querySelector(".ask-user-card-question");
        return !card || card.textContent !== prevQuestion;
      },
      questionBefore,
      { timeout: 90_000 }
    );
  });

  // KI-2 regression: before Cancel existed, a required question with no way out meant a user
  // trying to move on to something unrelated had nowhere to type it except the question card's
  // own input — which then submitted their message as the literal answer. Cancel proves there's
  // now a real way to decline any question (required or not) without it being mistaken for data.
  test("Cancel is always available, even on a required question, and frees the main input again", async () => {
    // Continuing the same conversation as the prior test — configAgent.md's agent-creation
    // flow asks several domain-essential questions in sequence, so the next chat turn is very
    // likely to surface another one.
    await typeIntoField(page, "#inp", "What else do you need to know?");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".ask-user-card", { timeout: 90_000 });

    // KI-3: the disabled main input must describe a question, not an approval gate.
    const placeholder = await page.getAttribute("#inp", "placeholder");
    expect(placeholder).toContain("Answer or cancel the question above");

    const questionBefore = await page.textContent(".ask-user-card-question");
    await clickByText(page, "Cancel", ".ask-user-card");

    // Cancel resolved *this* question rather than leaving the run stuck — the card either
    // clears entirely, or (a multi-question flow) is replaced by a different question. Either
    // way it proves the pause released, same "clears or advances" reasoning as the first test.
    await page.waitForFunction(
      (prevQuestion) => {
        const card = document.querySelector(".ask-user-card-question");
        return !card || card.textContent !== prevQuestion;
      },
      questionBefore,
      { timeout: 90_000 }
    );

    // If nothing else picked up the pause, the main input's placeholder must be back to a
    // normal "message me" prompt — not the blocked-state text — proving sendDisabled actually
    // cleared rather than the run being left permanently paused on a cancelled question.
    const stillBlocked = (await page.$(".ask-user-card")) !== null;
    if (!stillBlocked) {
      const placeholderAfter = await page.getAttribute("#inp", "placeholder");
      expect(placeholderAfter).not.toContain("continue…");
    }
  });
});
