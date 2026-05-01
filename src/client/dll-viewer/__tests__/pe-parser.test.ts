import { describe, expect, it } from "vitest";

import { parsePortableExecutable } from "../pe-parser";

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function buildPeFixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(1024);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const peOffset = 0x80;
  const coffOffset = peOffset + 4;
  const optionalOffset = coffOffset + 20;
  const sectionTableOffset = optionalOffset + 0xf0;

  writeAscii(bytes, 0, "MZ");
  view.setUint32(0x3c, peOffset, true);
  writeAscii(bytes, peOffset, "PE\0\0");
  view.setUint16(coffOffset, 0x8664, true);
  view.setUint16(coffOffset + 2, 1, true);
  view.setUint16(coffOffset + 16, 0xf0, true);
  view.setUint16(coffOffset + 18, 0x2022, true);

  view.setUint16(optionalOffset, 0x20b, true);
  view.setUint32(optionalOffset + 16, 0x1010, true);
  view.setUint32(optionalOffset + 24, 0x400000, true);
  view.setUint32(optionalOffset + 32, 0x1000, true);
  view.setUint32(optionalOffset + 36, 0x200, true);
  view.setUint32(optionalOffset + 56, 0x3000, true);
  view.setUint32(optionalOffset + 60, 0x200, true);
  view.setUint16(optionalOffset + 68, 3, true);
  view.setUint16(optionalOffset + 70, 0x0140, true);
  view.setUint32(optionalOffset + 108, 16, true);
  view.setUint32(optionalOffset + 112, 0x1100, true);
  view.setUint32(optionalOffset + 116, 0x60, true);
  view.setUint32(optionalOffset + 120, 0x1180, true);
  view.setUint32(optionalOffset + 124, 0x80, true);

  writeAscii(bytes, sectionTableOffset, ".rdata");
  view.setUint32(sectionTableOffset + 8, 0x1000, true);
  view.setUint32(sectionTableOffset + 12, 0x1000, true);
  view.setUint32(sectionTableOffset + 16, 0x200, true);
  view.setUint32(sectionTableOffset + 20, 0x200, true);
  view.setUint32(sectionTableOffset + 36, 0x40000040, true);

  const exportOffset = 0x300;
  view.setUint32(exportOffset + 12, 0x1140, true);
  view.setUint32(exportOffset + 16, 1, true);
  view.setUint32(exportOffset + 20, 1, true);
  view.setUint32(exportOffset + 24, 1, true);
  view.setUint32(exportOffset + 28, 0x1150, true);
  view.setUint32(exportOffset + 32, 0x1154, true);
  view.setUint32(exportOffset + 36, 0x1158, true);
  writeAscii(bytes, 0x340, "fixture.dll\0");
  view.setUint32(0x350, 0x1010, true);
  view.setUint32(0x354, 0x1160, true);
  view.setUint16(0x358, 0, true);
  writeAscii(bytes, 0x360, "FixtureExport\0");

  const importOffset = 0x380;
  view.setUint32(importOffset, 0x11d0, true);
  view.setUint32(importOffset + 12, 0x11c0, true);
  view.setUint32(importOffset + 16, 0x11e0, true);
  writeAscii(bytes, 0x3c0, "KERNEL32.dll\0");
  view.setUint32(0x3d0, 0x11f0, true);
  view.setUint32(0x3d4, 0, true);
  view.setUint16(0x3f0, 7, true);
  writeAscii(bytes, 0x3f2, "CreateFileW\0");

  return buffer;
}

describe("parsePortableExecutable", () => {
  it("parses PE headers, sections, exports, and imports", () => {
    const parsed = parsePortableExecutable(buildPeFixture(), "fixture.dll");

    expect(parsed.coffHeader.machine).toBe("x86-64");
    expect(parsed.coffHeader.characteristics).toContain("DLL");
    expect(parsed.optionalHeader.format).toBe("PE32+");
    expect(parsed.optionalHeader.subsystem).toBe("Windows Console");
    expect(parsed.sections[0]).toMatchObject({ name: ".rdata", virtualAddress: 0x1000 });
    expect(parsed.exports?.dllName).toBe("fixture.dll");
    expect(parsed.exports?.namedExports[0]).toMatchObject({ name: "FixtureExport", ordinal: 1, rva: 0x1010 });
    expect(parsed.imports[0]).toMatchObject({ name: "KERNEL32.dll" });
    expect(parsed.imports[0].functions[0]).toMatchObject({ name: "CreateFileW", hint: 7 });
  });

  it("rejects non-PE input", () => {
    expect(() => parsePortableExecutable(new Uint8Array([1, 2, 3]).buffer, "raw.bin")).toThrow(/missing MZ/);
  });
});
