import { describe, expect, it } from "vitest";
import { isSuspiciousGitIdentity } from "../git-operations";

describe("isSuspiciousGitIdentity", () => {
  it("accepts a normal human identity", () => {
    expect(isSuspiciousGitIdentity("Phodal Huang", "h@phodal.com")).toBe(false);
  });

  it("rejects example.com placeholder emails", () => {
    expect(isSuspiciousGitIdentity("Example User", "user@example.com")).toBe(true);
  });

  it("rejects obvious test identities", () => {
    expect(isSuspiciousGitIdentity("Routa Test", "test@example.com")).toBe(true);
  });
});
