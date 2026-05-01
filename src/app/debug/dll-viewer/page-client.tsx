"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";

import {
  parsePortableExecutable,
  type PeDataDirectory,
  type PeExport,
  type PeImportLibrary,
  type PeSection,
  type PortableExecutableView,
} from "@/client/dll-viewer/pe-parser";
import { toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

type ParseStage = "idle" | "parsing" | "ready" | "error";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function truncateJson(value: string): string {
  const maxLength = 60_000;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...`;
}

function FieldGrid({ fields }: { fields: Array<[string, string]> }) {
  return (
    <dl className="dll-grid">
      {fields.map(([label, value]) => (
        <div className="dll-field" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlagList({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="dll-muted">-</span>;
  return (
    <div className="dll-flags">
      {values.map((value) => (
        <span key={value}>{value}</span>
      ))}
    </div>
  );
}

function SectionsTable({ labels, sections }: { labels: ReturnType<typeof useDllViewerLabels>; sections: PeSection[] }) {
  return (
    <section className="dll-section">
      <h2>{labels.dllViewerSections}</h2>
      <div className="dll-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{labels.dllViewerName}</th>
              <th>{labels.dllViewerVirtualAddress}</th>
              <th>{labels.dllViewerVirtualSize}</th>
              <th>{labels.dllViewerRawPointer}</th>
              <th>{labels.dllViewerRawSize}</th>
              <th>{labels.dllViewerCharacteristics}</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={`${section.name}-${section.virtualAddress}`}>
                <td>{section.name}</td>
                <td>{hex(section.virtualAddress)}</td>
                <td>{formatBytes(section.virtualSize)}</td>
                <td>{hex(section.rawPointer)}</td>
                <td>{formatBytes(section.rawSize)}</td>
                <td>
                  <FlagList values={section.characteristics} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DirectoriesTable({
  directories,
  labels,
}: {
  directories: PeDataDirectory[];
  labels: ReturnType<typeof useDllViewerLabels>;
}) {
  return (
    <section className="dll-section">
      <h2>{labels.dllViewerDataDirectories}</h2>
      <div className="dll-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{labels.dllViewerName}</th>
              <th>{labels.dllViewerRva}</th>
              <th>{labels.dllViewerSize}</th>
            </tr>
          </thead>
          <tbody>
            {directories.map((directory) => (
              <tr key={directory.name}>
                <td>{directory.name}</td>
                <td>{hex(directory.rva)}</td>
                <td>{formatBytes(directory.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExportsTable({ labels, exports }: { labels: ReturnType<typeof useDllViewerLabels>; exports: PeExport[] }) {
  const visibleExports = exports.slice(0, 240);
  return (
    <>
      {exports.length > visibleExports.length ? (
        <p className="dll-muted">{labels.dllViewerShowingFirstExports.replace("{count}", String(visibleExports.length))}</p>
      ) : null}
      <div className="dll-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{labels.dllViewerName}</th>
              <th>{labels.dllViewerOrdinal}</th>
              <th>{labels.dllViewerRva}</th>
              <th>{labels.dllViewerForwardedTo}</th>
            </tr>
          </thead>
          <tbody>
            {visibleExports.map((exported) => (
              <tr key={`${exported.ordinal}-${exported.name}`}>
                <td>{exported.name}</td>
                <td>{exported.ordinal}</td>
                <td>{hex(exported.rva)}</td>
                <td>{exported.forwardedTo ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ImportsView({ imports, labels }: { imports: PeImportLibrary[]; labels: ReturnType<typeof useDllViewerLabels> }) {
  if (imports.length === 0) {
    return <p className="dll-muted">{labels.dllViewerNoImports}</p>;
  }

  return (
    <div className="dll-imports">
      {imports.map((library) => {
        const visibleFunctions = library.functions.slice(0, 80);
        return (
          <details key={library.name} open>
            <summary>
              <span>{library.name}</span>
              <span>{labels.dllViewerFunctions.replace("{count}", String(library.functions.length))}</span>
            </summary>
            <div className="dll-import-list">
              {visibleFunctions.map((imported) => (
                <span key={`${library.name}-${imported.name}-${imported.hint ?? imported.ordinal ?? ""}`}>
                  {imported.name}
                </span>
              ))}
            </div>
            {library.functions.length > visibleFunctions.length ? (
              <p className="dll-muted">{labels.dllViewerShowingFirstImports.replace("{count}", String(visibleFunctions.length))}</p>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

function useDllViewerLabels() {
  const { t } = useTranslation();
  return t.debug;
}

function ParsedDllView({ parsed }: { parsed: PortableExecutableView }) {
  const labels = useDllViewerLabels();
  const summaryFields = useMemo<Array<[string, string]>>(
    () => [
      [labels.dllViewerFile, `${parsed.fileName} · ${formatBytes(parsed.fileSize)}`],
      [labels.dllViewerFormat, parsed.optionalHeader.format],
      [labels.dllViewerMachine, parsed.coffHeader.machine],
      [labels.dllViewerSubsystem, parsed.optionalHeader.subsystem],
      [labels.dllViewerEntryPoint, hex(parsed.optionalHeader.entryPoint)],
      [labels.dllViewerImageBase, parsed.optionalHeader.imageBase],
      [labels.dllViewerTimestamp, parsed.coffHeader.timestamp],
      [labels.dllViewerPeOffset, hex(parsed.dosHeader.peHeaderOffset)],
      [labels.dllViewerSectionAlignment, formatBytes(parsed.optionalHeader.sectionAlignment)],
      [labels.dllViewerFileAlignment, formatBytes(parsed.optionalHeader.fileAlignment)],
      [labels.dllViewerSizeOfImage, formatBytes(parsed.optionalHeader.sizeOfImage)],
      [labels.dllViewerChecksum, hex(parsed.optionalHeader.checksum)],
    ],
    [labels, parsed],
  );

  return (
    <div className="dll-output">
      <section className="dll-section">
        <h2>{labels.dllViewerSummary}</h2>
        <FieldGrid fields={summaryFields} />
        <div className="dll-flag-row">
          <strong>{labels.dllViewerCharacteristics}</strong>
          <FlagList values={[...parsed.coffHeader.characteristics, ...parsed.optionalHeader.dllCharacteristics]} />
        </div>
      </section>

      <section className="dll-section">
        <h2>{labels.dllViewerExports}</h2>
        {parsed.exports ? (
          <>
            <FieldGrid
              fields={[
                [labels.dllViewerDllName, parsed.exports.dllName || "-"],
                [labels.dllViewerOrdinalBase, String(parsed.exports.ordinalBase)],
                [labels.dllViewerFunctionCount, String(parsed.exports.functionCount)],
              ]}
            />
            <ExportsTable exports={parsed.exports.namedExports} labels={labels} />
          </>
        ) : (
          <p className="dll-muted">{labels.dllViewerNoExports}</p>
        )}
      </section>

      <section className="dll-section">
        <h2>{labels.dllViewerImports}</h2>
        <ImportsView imports={parsed.imports} labels={labels} />
      </section>

      <SectionsTable labels={labels} sections={parsed.sections} />
      <DirectoriesTable directories={parsed.dataDirectories} labels={labels} />

      {parsed.warnings.length > 0 ? (
        <section className="dll-section">
          <h2>{labels.dllViewerWarnings}</h2>
          <ul className="dll-warnings">
            {parsed.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="dll-section">
        <details>
          <summary>{labels.dllViewerRawJson}</summary>
          <pre>{truncateJson(JSON.stringify(parsed, null, 2))}</pre>
        </details>
      </section>
    </div>
  );
}

export function DllViewerPageClient() {
  const labels = useDllViewerLabels();
  const [stage, setStage] = useState<ParseStage>("idle");
  const [parsed, setParsed] = useState<PortableExecutableView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = {
    idle: labels.dllViewerStatusIdle,
    parsing: labels.dllViewerStatusParsing,
    ready: labels.dllViewerStatusReady,
    error: labels.dllViewerStatusError,
  }[stage];

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setStage("parsing");
      setError(null);
      setParsed(null);

      try {
        const buffer = await file.arrayBuffer();
        setParsed(parsePortableExecutable(buffer, file.name));
        setStage("ready");
      } catch (parseError) {
        setError(toErrorMessage(parseError));
        setStage("error");
      }
    },
    [],
  );

  return (
    <main className="dll-viewer-page">
      <header>
        <div>
          <h1>{labels.dllViewerTitle}</h1>
          <p>{labels.dllViewerDescription}</p>
        </div>
        <label className="dll-file-button">
          <input accept=".dll,.exe,.sys,.ocx,.cpl,.scr,application/x-msdownload" type="file" onChange={handleFile} />
          {labels.dllViewerSelectFile}
        </label>
      </header>

      <div className={`dll-status dll-status-${stage}`}>
        <strong>{labels.dllViewerStatus}</strong>
        <span>{statusLabel}</span>
      </div>

      {error ? (
        <section className="dll-section dll-error">
          <h2>{labels.dllViewerError}</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {parsed ? <ParsedDllView parsed={parsed} /> : <p className="dll-empty">{labels.dllViewerNoResult}</p>}

      <style>{`
        .dll-viewer-page {
          min-height: 100vh;
          padding: 24px;
          background: #f6f7f9;
          color: #17202a;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          max-width: 1180px;
          margin: 0 auto 18px;
        }

        h1,
        h2,
        p {
          margin: 0;
        }

        h1 {
          font-size: 28px;
          font-weight: 760;
        }

        h2 {
          font-size: 16px;
          font-weight: 720;
        }

        header p,
        .dll-muted,
        .dll-empty {
          color: #596575;
        }

        .dll-file-button {
          display: inline-flex;
          min-height: 36px;
          align-items: center;
          justify-content: center;
          border: 1px solid #1d4ed8;
          border-radius: 6px;
          padding: 0 14px;
          background: #2563eb;
          color: white;
          font-size: 14px;
          font-weight: 650;
          cursor: pointer;
          white-space: nowrap;
        }

        .dll-file-button input {
          display: none;
        }

        .dll-status,
        .dll-section,
        .dll-empty {
          max-width: 1180px;
          margin: 0 auto 12px;
        }

        .dll-status {
          display: flex;
          gap: 8px;
          align-items: center;
          border: 1px solid #d5dbe4;
          border-radius: 6px;
          padding: 10px 12px;
          background: white;
        }

        .dll-status-ready {
          border-color: #86c89a;
        }

        .dll-status-error,
        .dll-error {
          border-color: #f0a4a4;
        }

        .dll-output {
          display: grid;
          gap: 12px;
        }

        .dll-section {
          border: 1px solid #d5dbe4;
          border-radius: 6px;
          padding: 14px;
          background: white;
        }

        .dll-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 10px;
          margin: 12px 0 0;
        }

        .dll-field {
          min-width: 0;
        }

        .dll-field dt {
          color: #667085;
          font-size: 12px;
          font-weight: 650;
        }

        .dll-field dd {
          margin: 3px 0 0;
          overflow-wrap: anywhere;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 13px;
        }

        .dll-flag-row {
          display: grid;
          gap: 8px;
          margin-top: 14px;
        }

        .dll-flags,
        .dll-import-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .dll-flags span,
        .dll-import-list span {
          border: 1px solid #d7dde6;
          border-radius: 999px;
          padding: 2px 8px;
          background: #f8fafc;
          font-size: 12px;
        }

        .dll-table-scroll {
          margin-top: 12px;
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        th,
        td {
          border-bottom: 1px solid #e4e8ef;
          padding: 8px;
          text-align: left;
          vertical-align: top;
        }

        th {
          color: #475467;
          font-size: 12px;
          font-weight: 720;
        }

        td {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        }

        details {
          margin-top: 10px;
        }

        summary {
          cursor: pointer;
          font-weight: 680;
        }

        .dll-imports {
          display: grid;
          gap: 10px;
          margin-top: 10px;
        }

        .dll-imports summary {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid #e4e8ef;
          padding-bottom: 8px;
        }

        .dll-import-list {
          margin-top: 10px;
        }

        .dll-warnings {
          margin: 10px 0 0;
          padding-left: 18px;
        }

        pre {
          max-height: 480px;
          overflow: auto;
          border: 1px solid #d5dbe4;
          border-radius: 6px;
          padding: 12px;
          background: #0f172a;
          color: #e2e8f0;
          font-size: 12px;
          line-height: 1.5;
        }

        @media (max-width: 720px) {
          .dll-viewer-page {
            padding: 16px;
          }

          header {
            flex-direction: column;
          }

          .dll-file-button {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
