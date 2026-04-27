import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "src", "client", "canvas-sdk");
const barrelPath = path.join(sourceDir, "index.ts");
const outputDir = path.join(rootDir, "resources", "canvas", "sdk");
const manifestPath = path.join(rootDir, "resources", "canvas", "canvas-sdk-manifest.json");

function getLeadingGroupLabel(sourceText, statement) {
  const ranges = ts.getLeadingCommentRanges(sourceText, statement.pos) ?? [];
  const labels = ranges
    .map((range) => sourceText.slice(range.pos, range.end))
    .map((comment) => comment.replace(/^\/\//u, "").trim())
    .filter(Boolean);
  return labels[labels.length - 1] ?? "General";
}

function collectGroups(sourceText, sourceFile) {
  const groups = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    const group = getLeadingGroupLabel(sourceText, statement);
    const modulePath = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;

    groups.push({
      title: group,
      source: modulePath,
      symbols: statement.exportClause.elements.map((element) => ({
        name: element.name.text,
        kind: element.isTypeOnly ? "type" : "value",
      })),
    });
  }

  return groups;
}

async function emitDefinitions() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    outDir: outputDir,
    rootDir: sourceDir,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: false,
  };

  const program = ts.createProgram([barrelPath], options);
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...program.emit().diagnostics,
  ];

  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => "\n",
    }));
  }
}

async function main() {
  await emitDefinitions();

  const barrelSource = await fs.readFile(barrelPath, "utf8");
  const sourceFile = ts.createSourceFile(
    barrelPath,
    barrelSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const groups = collectGroups(barrelSource, sourceFile);
  const indexDtsPath = path.join(outputDir, "index.d.ts");
  const indexDtsSource = await fs.readFile(indexDtsPath, "utf8");
  const publicDefinitionNames = new Set([
    "index.d.ts",
    ...groups
      .map((group) => group.source)
      .filter(Boolean)
      .map((source) => `${source.replace(/^\.\//u, "")}.d.ts`),
  ]);
  const emittedDefinitionEntries = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"));
  await Promise.all(
    emittedDefinitionEntries
      .filter((entry) => !publicDefinitionNames.has(entry.name))
      .map((entry) => fs.rm(path.join(outputDir, entry.name), { force: true })),
  );
  const definitionEntries = emittedDefinitionEntries
    .filter((entry) => publicDefinitionNames.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const definitionFiles = await Promise.all(
    definitionEntries.map(async (fileName) => {
      const filePath = path.join(outputDir, fileName);
      return {
        path: path.posix.join("resources", "canvas", "sdk", fileName),
        source: await fs.readFile(filePath, "utf8"),
      };
    }),
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    moduleSpecifier: "routa/canvas",
    sourceBarrel: "src/client/canvas-sdk/index.ts",
    definitionsDir: "resources/canvas/sdk",
    indexDefinitionPath: "resources/canvas/sdk/index.d.ts",
    importExamples: [
      "import { Stack, H1, Text, Card, CardBody, Table, Stat } from 'routa/canvas';",
      "import { useHostTheme, useCanvasState } from 'routa/canvas';",
      "import { BarChart, LineChart, PieChart } from 'routa/canvas';",
    ],
    promptRules: [
      "Import only from routa/canvas or react. Legacy cursor/canvas and @canvas-sdk imports still compile, but new canvases should use routa/canvas.",
      "Prefer SDK primitives over raw div/span markup when possible.",
      "Use useHostTheme() tokens instead of hardcoded colors.",
      "If a symbol is not present in the generated SDK surface below, do not invent it.",
    ],
    groups,
    allExports: groups.flatMap((group) => group.symbols),
    definitionFiles,
    indexDtsSource,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Generated canvas SDK definitions in ${path.relative(rootDir, outputDir)} and manifest at ${path.relative(rootDir, manifestPath)}\n`,
  );
}

await main();
