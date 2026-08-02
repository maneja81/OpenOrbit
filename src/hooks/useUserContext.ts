import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { USER_CONTEXT_FIELDS, UserContextKey } from "@/lib/userContext";

type UserContextValues = Record<UserContextKey, string>;

const EMPTY_VALUES = Object.fromEntries(USER_CONTEXT_FIELDS.map((field) => [field.key, ""])) as UserContextValues;

/** Reads and writes the onboarding context answers held in the user-fact store, so
 * Settings → General → About you can edit what onboarding asked once. Fetches when
 * `active` turns true (the Settings panel opening) rather than on mount — the answers only
 * matter while that section is on screen, and an agent's own save_user_info call can change
 * them in between. */
export function useUserContext(active: boolean) {
  const [values, setValues] = useState<UserContextValues>(EMPTY_VALUES);

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    try {
      const facts = await window.agentsAPI.userInfo.list();
      const byQuestion = new Map(facts.map((fact) => [fact.question, fact.answer]));
      setValues(
        Object.fromEntries(
          USER_CONTEXT_FIELDS.map((field) => [field.key, byQuestion.get(field.factQuestion) ?? ""])
        ) as UserContextValues
      );
    } catch (error: unknown) {
      // Non-fatal: the section stays on its last known values rather than blanking out.
      window.agentsAPI.dev.log("[userContext] failed to load facts", error);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Started outside the effect's synchronous execution, matching useSettings — the React
    // Compiler lint rejects a setState reachable synchronously from an effect body.
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [active, refresh]);

  const setValue = useCallback(async (key: UserContextKey, value: string) => {
    const field = USER_CONTEXT_FIELDS.find((candidate) => candidate.key === key);
    if (!field) return;
    // Optimistic: the control reflects the choice immediately, and the store is the only
    // other reader — a failed write is logged and corrected on the next open.
    setValues((prev) => ({ ...prev, [key]: value }));
    if (!hasAgentsAPI()) return;
    try {
      await window.agentsAPI.userInfo.setFact(field.factQuestion, value);
    } catch (error: unknown) {
      window.agentsAPI.dev.log("[userContext] failed to save fact", error);
    }
  }, []);

  return { values, setValue };
}
