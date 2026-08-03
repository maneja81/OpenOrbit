import { describe, expect, it } from "vitest";
import { parseMacMemoryFromVmStat } from "./systemStats";

// Real `vm_stat` output captured from a dev machine, used verbatim as a fixture — this
// is the exact case that motivated the fix: os.freemem()-based calculation reported 99%
// used against this same total, while this parses to ~79%.
const REAL_VM_STAT_OUTPUT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5076.
Pages active:                            107971.
Pages inactive:                          106508.
Pages speculative:                          844.
Pages throttled:                              0.
Pages wired down:                        111522.
Pages purgeable:                            429.
"Translation faults":                 717814376.
Pages copy-on-write:                   15925863.
Pages zero filled:                    150637465.
Pages reactivated:                    326258363.
Pages purged:                          11753388.
File-backed pages:                        70018.
Anonymous pages:                         145305.
Pages stored in compressor:              677154.
Pages occupied by compressor:            148632.
Decompressions:                       353417556.
Compressions:                         378186599.
Pageins:                               25988278.
Pageouts:                                690778.
Swapins:                               10554789.
Swapouts:                              11137186.
`;

describe("parseMacMemoryFromVmStat", () => {
  it("computes a lower, more realistic used% than a naive free-pages-only calculation", () => {
    const totalBytes = 8 * 1024 ** 3; // 8 GB, matching the machine this fixture came from
    const result = parseMacMemoryFromVmStat(REAL_VM_STAT_OUTPUT, totalBytes);
    expect(result).not.toBeNull();
    expect(result!.ramPct).toBeLessThan(85);
    expect(result!.ramPct).toBeGreaterThan(70);
    expect(result!.ramTotalGB).toBe(8);
  });

  it("returns null when the output doesn't look like vm_stat at all (no page size line)", () => {
    expect(parseMacMemoryFromVmStat("not vm_stat output", 8 * 1024 ** 3)).toBeNull();
  });

  it("treats missing page-count lines as zero rather than throwing", () => {
    const minimal = "Mach Virtual Memory Statistics: (page size of 4096 bytes)\n";
    const result = parseMacMemoryFromVmStat(minimal, 8 * 1024 ** 3);
    expect(result).not.toBeNull();
    // No free/inactive/speculative pages parsed => 0 available => 100% used.
    expect(result!.ramPct).toBe(100);
  });
});
