/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { toFolderSlug } from "../folder-slug";

describe("toFolderSlug", () => {
  it("converts a basic Unix path", () => {
    expect(toFolderSlug("/Users/john/my-project")).toBe("Users-john-my-project");
  });

  it("converts a Windows path", () => {
    expect(toFolderSlug("C:\\Users\\john\\project")).toBe("C-Users-john-project");
  });

  it("strips colon from Windows non-C drive path", () => {
    expect(toFolderSlug("E:\\routa")).toBe("E-routa");
  });

  it("collapses consecutive separators", () => {
    expect(toFolderSlug("/Users//john///project")).toBe("Users-john-project");
  });

  it("handles mixed separators", () => {
    expect(toFolderSlug("/Users/john\\project")).toBe("Users-john-project");
  });

  it("is deterministic", () => {
    const path = "/Users/john/my-project";
    expect(toFolderSlug(path)).toBe(toFolderSlug(path));
  });

  it("strips leading separators", () => {
    expect(toFolderSlug("///Users/john")).toBe("Users-john");
  });

  it("strips trailing separators", () => {
    expect(toFolderSlug("/Users/john/my-project/")).toBe("Users-john-my-project");
  });

  it("produces same slug with or without trailing slash", () => {
    expect(toFolderSlug("/Users/john/project/")).toBe(toFolderSlug("/Users/john/project"));
  });
});
