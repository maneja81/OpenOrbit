import { describe, expect, it } from "vitest";
import { entryIcon } from "./knowledgeEntryIcon";

describe("entryIcon", () => {
  it("gives each kind a distinct icon", () => {
    // A folder row rendering as a document would misrepresent what its remove button does —
    // revoke access, not delete a stored copy.
    const icons = [entryIcon("folder"), entryIcon("url"), entryIcon("file")];
    expect(new Set(icons).size).toBe(3);
  });

  it("marks folders with the folder icon and web pages with the globe", () => {
    expect(entryIcon("folder")).toBe("ti-folder");
    expect(entryIcon("url")).toBe("ti-world");
    expect(entryIcon("file")).toBe("ti-file-text");
  });
});
