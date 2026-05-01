export type PeDataDirectory = {
  name: string;
  rva: number;
  size: number;
};

export type PeSection = {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawPointer: number;
  rawSize: number;
  characteristics: string[];
};

export type PeExport = {
  name: string;
  ordinal: number;
  rva: number;
  forwardedTo?: string;
};

export type PeImport = {
  name: string;
  hint?: number;
  ordinal?: number;
};

export type PeImportLibrary = {
  name: string;
  functions: PeImport[];
};

export type PortableExecutableView = {
  fileName: string;
  fileSize: number;
  dosHeader: {
    peHeaderOffset: number;
    stubText: string;
  };
  coffHeader: {
    machine: string;
    machineValue: number;
    sectionCount: number;
    timestamp: string;
    characteristics: string[];
  };
  optionalHeader: {
    format: string;
    entryPoint: number;
    imageBase: string;
    subsystem: string;
    sectionAlignment: number;
    fileAlignment: number;
    sizeOfImage: number;
    checksum: number;
    dllCharacteristics: string[];
  };
  dataDirectories: PeDataDirectory[];
  sections: PeSection[];
  exports: {
    dllName: string;
    ordinalBase: number;
    functionCount: number;
    namedExports: PeExport[];
  } | null;
  imports: PeImportLibrary[];
  warnings: string[];
};

const DATA_DIRECTORY_NAMES = [
  "Export Table",
  "Import Table",
  "Resource Table",
  "Exception Table",
  "Certificate Table",
  "Base Relocation Table",
  "Debug",
  "Architecture",
  "Global Ptr",
  "TLS Table",
  "Load Config Table",
  "Bound Import",
  "Import Address Table",
  "Delay Import Descriptor",
  "CLR Runtime Header",
  "Reserved",
];

const MACHINE_NAMES = new Map<number, string>([
  [0x014c, "x86"],
  [0x01c0, "ARM"],
  [0x01c4, "ARMv7"],
  [0x0200, "Intel Itanium"],
  [0x8664, "x86-64"],
  [0xaa64, "ARM64"],
]);

const SUBSYSTEM_NAMES = new Map<number, string>([
  [1, "Native"],
  [2, "Windows GUI"],
  [3, "Windows Console"],
  [5, "OS/2 Console"],
  [7, "POSIX Console"],
  [9, "Windows CE GUI"],
  [10, "EFI Application"],
  [11, "EFI Boot Service Driver"],
  [12, "EFI Runtime Driver"],
  [13, "EFI ROM"],
  [14, "Xbox"],
  [16, "Windows Boot Application"],
]);

const COFF_CHARACTERISTICS: Array<[number, string]> = [
  [0x0002, "Executable"],
  [0x0020, "Large address aware"],
  [0x0100, "32-bit machine"],
  [0x0200, "Debug symbols stripped"],
  [0x2000, "DLL"],
  [0x4000, "Uniprocessor only"],
];

const DLL_CHARACTERISTICS: Array<[number, string]> = [
  [0x0020, "High entropy VA"],
  [0x0040, "Dynamic base"],
  [0x0080, "Force integrity"],
  [0x0100, "NX compatible"],
  [0x0200, "No isolation"],
  [0x0400, "No SEH"],
  [0x0800, "No bind"],
  [0x1000, "AppContainer"],
  [0x2000, "WDM driver"],
  [0x4000, "Guard CF"],
  [0x8000, "Terminal Server aware"],
];

const SECTION_CHARACTERISTICS: Array<[number, string]> = [
  [0x00000020, "Code"],
  [0x00000040, "Initialized data"],
  [0x00000080, "Uninitialized data"],
  [0x02000000, "Discardable"],
  [0x04000000, "Not cached"],
  [0x08000000, "Not paged"],
  [0x10000000, "Shared"],
  [0x20000000, "Execute"],
  [0x40000000, "Read"],
  [0x80000000, "Write"],
];

function flagsFrom(value: number, definitions: Array<[number, string]>): string[] {
  return definitions.filter(([flag]) => (value & flag) !== 0).map(([, label]) => label);
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

class PeReader {
  readonly data: DataView;
  readonly bytes: Uint8Array;
  readonly warnings: string[] = [];

  constructor(buffer: ArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.data = new DataView(buffer);
  }

  has(offset: number, length: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset + length <= this.data.byteLength;
  }

  u16(offset: number): number {
    if (!this.has(offset, 2)) throw new Error(`PE read out of bounds at ${hex(offset)}`);
    return this.data.getUint16(offset, true);
  }

  u32(offset: number): number {
    if (!this.has(offset, 4)) throw new Error(`PE read out of bounds at ${hex(offset)}`);
    return this.data.getUint32(offset, true);
  }

  u64(offset: number): bigint {
    const low = BigInt(this.u32(offset));
    const high = BigInt(this.u32(offset + 4));
    return (high << 32n) | low;
  }

  ascii(offset: number, length: number): string {
    if (!this.has(offset, length)) return "";
    let result = "";
    for (let index = 0; index < length; index += 1) {
      const byte = this.bytes[offset + index];
      if (byte === 0) break;
      if (byte >= 32 && byte <= 126) result += String.fromCharCode(byte);
    }
    return result;
  }

  cString(offset: number, maxLength = 4096): string {
    if (!this.has(offset, 1)) return "";
    let result = "";
    for (let index = offset; index < this.bytes.length && index < offset + maxLength; index += 1) {
      const byte = this.bytes[index];
      if (byte === 0) break;
      if (byte >= 32 && byte <= 126) result += String.fromCharCode(byte);
    }
    return result;
  }
}

function rvaToOffset(rva: number, sections: PeSection[], sizeOfHeaders: number): number | null {
  if (rva > 0 && rva < sizeOfHeaders) return rva;

  for (const section of sections) {
    const sectionSize = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + sectionSize) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }

  return null;
}

function readTimestamp(seconds: number): string {
  if (seconds === 0) return "0";
  return new Date(seconds * 1000).toISOString();
}

function readDataDirectories(reader: PeReader, start: number, count: number): PeDataDirectory[] {
  const directories: PeDataDirectory[] = [];
  const safeCount = Math.min(count, DATA_DIRECTORY_NAMES.length);

  for (let index = 0; index < safeCount; index += 1) {
    const offset = start + index * 8;
    if (!reader.has(offset, 8)) break;

    const rva = reader.u32(offset);
    const size = reader.u32(offset + 4);
    if (rva !== 0 || size !== 0) {
      directories.push({ name: DATA_DIRECTORY_NAMES[index], rva, size });
    }
  }

  return directories;
}

function readSections(reader: PeReader, sectionTableOffset: number, count: number): PeSection[] {
  const sections: PeSection[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = sectionTableOffset + index * 40;
    if (!reader.has(offset, 40)) {
      reader.warnings.push(`Section table truncated before section ${index + 1}.`);
      break;
    }

    sections.push({
      name: reader.ascii(offset, 8) || `section_${index + 1}`,
      virtualSize: reader.u32(offset + 8),
      virtualAddress: reader.u32(offset + 12),
      rawSize: reader.u32(offset + 16),
      rawPointer: reader.u32(offset + 20),
      characteristics: flagsFrom(reader.u32(offset + 36), SECTION_CHARACTERISTICS),
    });
  }

  return sections;
}

function findDirectory(directories: PeDataDirectory[], name: string): PeDataDirectory | undefined {
  return directories.find((directory) => directory.name === name && directory.rva !== 0 && directory.size !== 0);
}

function readExports(
  reader: PeReader,
  directories: PeDataDirectory[],
  sections: PeSection[],
  sizeOfHeaders: number,
): PortableExecutableView["exports"] {
  const directory = findDirectory(directories, "Export Table");
  if (!directory) return null;

  const directoryOffset = rvaToOffset(directory.rva, sections, sizeOfHeaders);
  if (directoryOffset == null || !reader.has(directoryOffset, 40)) {
    reader.warnings.push("Export table points outside the mapped sections.");
    return null;
  }

  const dllNameOffset = rvaToOffset(reader.u32(directoryOffset + 12), sections, sizeOfHeaders);
  const ordinalBase = reader.u32(directoryOffset + 16);
  const functionCount = reader.u32(directoryOffset + 20);
  const nameCount = reader.u32(directoryOffset + 24);
  const functionsOffset = rvaToOffset(reader.u32(directoryOffset + 28), sections, sizeOfHeaders);
  const namesOffset = rvaToOffset(reader.u32(directoryOffset + 32), sections, sizeOfHeaders);
  const ordinalsOffset = rvaToOffset(reader.u32(directoryOffset + 36), sections, sizeOfHeaders);
  const namedExports: PeExport[] = [];

  if (functionsOffset == null || namesOffset == null || ordinalsOffset == null) {
    reader.warnings.push("Export name arrays point outside the mapped sections.");
  } else {
    const safeNameCount = Math.min(nameCount, 5000);
    for (let index = 0; index < safeNameCount; index += 1) {
      const nameRva = reader.u32(namesOffset + index * 4);
      const nameOffset = rvaToOffset(nameRva, sections, sizeOfHeaders);
      const ordinalIndex = reader.u16(ordinalsOffset + index * 2);
      const functionRva = reader.u32(functionsOffset + ordinalIndex * 4);
      const forwardedTo =
        functionRva >= directory.rva && functionRva < directory.rva + directory.size
          ? reader.cString(rvaToOffset(functionRva, sections, sizeOfHeaders) ?? -1)
          : undefined;

      namedExports.push({
        name: nameOffset == null ? `(name at ${hex(nameRva)})` : reader.cString(nameOffset),
        ordinal: ordinalBase + ordinalIndex,
        rva: functionRva,
        ...(forwardedTo ? { forwardedTo } : {}),
      });
    }

    if (nameCount > safeNameCount) {
      reader.warnings.push(`Export list truncated to ${safeNameCount} names.`);
    }
  }

  return {
    dllName: dllNameOffset == null ? "" : reader.cString(dllNameOffset),
    ordinalBase,
    functionCount,
    namedExports,
  };
}

function readImports(
  reader: PeReader,
  directories: PeDataDirectory[],
  sections: PeSection[],
  sizeOfHeaders: number,
  isPe32Plus: boolean,
): PeImportLibrary[] {
  const directory = findDirectory(directories, "Import Table");
  if (!directory) return [];

  const importOffset = rvaToOffset(directory.rva, sections, sizeOfHeaders);
  if (importOffset == null) {
    reader.warnings.push("Import table points outside the mapped sections.");
    return [];
  }

  const libraries: PeImportLibrary[] = [];
  for (let descriptor = 0; descriptor < 256; descriptor += 1) {
    const offset = importOffset + descriptor * 20;
    if (!reader.has(offset, 20)) break;

    const originalFirstThunk = reader.u32(offset);
    const nameRva = reader.u32(offset + 12);
    const firstThunk = reader.u32(offset + 16);
    if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;

    const nameOffset = rvaToOffset(nameRva, sections, sizeOfHeaders);
    const thunkOffset = rvaToOffset(originalFirstThunk || firstThunk, sections, sizeOfHeaders);
    const functions: PeImport[] = [];

    if (thunkOffset == null) {
      reader.warnings.push(`Import thunk table for descriptor ${descriptor + 1} points outside mapped sections.`);
    } else {
      const thunkSize = isPe32Plus ? 8 : 4;
      const ordinalMask = isPe32Plus ? 0x8000000000000000n : 0x80000000n;
      const valueMask = isPe32Plus ? 0x7fffffffffffffffn : 0x7fffffffn;

      for (let index = 0; index < 2000; index += 1) {
        const thunkEntryOffset = thunkOffset + index * thunkSize;
        if (!reader.has(thunkEntryOffset, thunkSize)) break;

        const thunkValue = isPe32Plus ? reader.u64(thunkEntryOffset) : BigInt(reader.u32(thunkEntryOffset));
        if (thunkValue === 0n) break;

        if ((thunkValue & ordinalMask) !== 0n) {
          functions.push({ name: `#${Number(thunkValue & 0xffffn)}`, ordinal: Number(thunkValue & 0xffffn) });
          continue;
        }

        const hintNameRva = Number(thunkValue & valueMask);
        const hintNameOffset = rvaToOffset(hintNameRva, sections, sizeOfHeaders);
        if (hintNameOffset == null || !reader.has(hintNameOffset, 2)) {
          functions.push({ name: `(import at ${hex(hintNameRva)})` });
          continue;
        }

        functions.push({
          hint: reader.u16(hintNameOffset),
          name: reader.cString(hintNameOffset + 2),
        });
      }
    }

    libraries.push({
      name: nameOffset == null ? `(library at ${hex(nameRva)})` : reader.cString(nameOffset),
      functions,
    });
  }

  return libraries;
}

export function parsePortableExecutable(buffer: ArrayBuffer, fileName: string): PortableExecutableView {
  const reader = new PeReader(buffer);

  if (reader.ascii(0, 2) !== "MZ") {
    throw new Error("Not a PE file: missing MZ DOS header.");
  }

  const peHeaderOffset = reader.u32(0x3c);
  if (reader.ascii(peHeaderOffset, 4) !== "PE") {
    throw new Error("Not a PE file: missing PE signature.");
  }

  const coffOffset = peHeaderOffset + 4;
  const machineValue = reader.u16(coffOffset);
  const sectionCount = reader.u16(coffOffset + 2);
  const timestamp = reader.u32(coffOffset + 4);
  const optionalHeaderSize = reader.u16(coffOffset + 16);
  const coffCharacteristics = reader.u16(coffOffset + 18);
  const optionalOffset = coffOffset + 20;
  const optionalMagic = reader.u16(optionalOffset);
  const isPe32Plus = optionalMagic === 0x20b;

  if (optionalMagic !== 0x10b && optionalMagic !== 0x20b) {
    throw new Error(`Unsupported PE optional header magic ${hex(optionalMagic)}.`);
  }

  const entryPoint = reader.u32(optionalOffset + 16);
  const imageBase = isPe32Plus ? reader.u64(optionalOffset + 24).toString() : String(reader.u32(optionalOffset + 28));
  const sectionAlignment = reader.u32(optionalOffset + 32);
  const fileAlignment = reader.u32(optionalOffset + 36);
  const sizeOfImage = reader.u32(optionalOffset + 56);
  const sizeOfHeaders = reader.u32(optionalOffset + 60);
  const checksum = reader.u32(optionalOffset + 64);
  const subsystemValue = reader.u16(optionalOffset + 68);
  const dllCharacteristicsValue = reader.u16(optionalOffset + 70);
  const directoryCountOffset = optionalOffset + (isPe32Plus ? 108 : 92);
  const dataDirectoryOffset = optionalOffset + (isPe32Plus ? 112 : 96);
  const dataDirectories = readDataDirectories(reader, dataDirectoryOffset, reader.u32(directoryCountOffset));
  const sections = readSections(reader, optionalOffset + optionalHeaderSize, sectionCount);

  return {
    fileName,
    fileSize: buffer.byteLength,
    dosHeader: {
      peHeaderOffset,
      stubText: reader.ascii(0x40, Math.max(0, peHeaderOffset - 0x40)),
    },
    coffHeader: {
      machine: MACHINE_NAMES.get(machineValue) ?? `Unknown (${hex(machineValue)})`,
      machineValue,
      sectionCount,
      timestamp: readTimestamp(timestamp),
      characteristics: flagsFrom(coffCharacteristics, COFF_CHARACTERISTICS),
    },
    optionalHeader: {
      format: isPe32Plus ? "PE32+" : "PE32",
      entryPoint,
      imageBase,
      subsystem: SUBSYSTEM_NAMES.get(subsystemValue) ?? `Unknown (${subsystemValue})`,
      sectionAlignment,
      fileAlignment,
      sizeOfImage,
      checksum,
      dllCharacteristics: flagsFrom(dllCharacteristicsValue, DLL_CHARACTERISTICS),
    },
    dataDirectories,
    sections,
    exports: readExports(reader, dataDirectories, sections, sizeOfHeaders),
    imports: readImports(reader, dataDirectories, sections, sizeOfHeaders, isPe32Plus),
    warnings: reader.warnings,
  };
}
