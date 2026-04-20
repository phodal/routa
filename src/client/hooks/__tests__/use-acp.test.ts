import { describe, expect, it } from "vitest";
import { AcpClientError } from "@/client/acp-client";
import { formatAcpErrorForLog } from "../use-acp";

describe("formatAcpErrorForLog", () => {
  it("surfaces nested errorData for ACP client errors", () => {
    const err = new AcpClientError(
      "Internal error",
      -32000,
      undefined,
      undefined,
      {
        method: "session/prompt",
        errorData: {
          details: "Permission denied",
          optionId: "approved",
        },
      },
      true,
    );

    expect(formatAcpErrorForLog(err)).toMatchObject({
      name: "AcpClientError",
      message: "Internal error",
      code: -32000,
      sessionMayContinue: true,
      errorData: {
        details: "Permission denied",
        optionId: "approved",
      },
    });
  });
});
