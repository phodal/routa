/**
 * Task Block Parser
 *
 * Parses `@@@task` / `@@@tasks` blocks from Routa agent responses.
 * Based on intent-0.2.4's task-block-parser.ts pattern.
 *
 * Format:
 * ```
 * @@@task
 * Task 1: Title here
 *
 * Objective
 * What this task should achieve...
 *
 * Scope
 * - files/areas in scope
 *
 * Definition of Done
 * 1. Acceptance criteria
 * @@@
 * ```
 *
 * Multiple tasks can be in a single @@@tasks block, separated by `---` or
 * by "Task N:" headings.
 */

export interface ParsedTask {
  id: string;
  title: string;
  objective: string;
  scope: string;
  definitionOfDone: string;
  /** Full raw markdown content */
  rawContent: string;
  /** Status: pending | confirmed | running | completed */
  status: "pending" | "confirmed" | "running" | "completed";
}

export interface TaskBlockResult {
  /** Parsed tasks */
  tasks: ParsedTask[];
  /** The original content with @@@task blocks removed */
  cleanedContent: string;
}

// Regex: match @@@task or @@@tasks blocks
const TASK_BLOCK_REGEX = /@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/g;

// Regex: split multiple tasks by "Task N:" pattern
const TASK_SPLIT_REGEX = /(?=^(?:Task\s+\d+|###?\s+Task\s+\d+)[:\s])/im;

/**
 * Check if content contains @@@task blocks.
 */
export function hasTaskBlocks(content: string): boolean {
  return /@@@tasks?\s*\n/.test(content);
}

/**
 * Extract and parse all @@@task blocks from content.
 * Returns the parsed tasks and the content with task blocks removed.
 */
export function extractTaskBlocks(content: string): TaskBlockResult {
  const tasks: ParsedTask[] = [];
  let cleanedContent = content;
  let counter = 0;

  // Find all @@@task blocks
  const matches = [...content.matchAll(TASK_BLOCK_REGEX)];

  for (const match of matches) {
    const blockContent = match[1].trim();
    // Remove this block from the cleaned content
    cleanedContent = cleanedContent.replace(match[0], "");

    // Split into individual tasks (if multiple tasks in one block)
    const taskSections = blockContent.split(TASK_SPLIT_REGEX).filter(Boolean);

    for (const section of taskSections) {
      counter++;
      const task = parseTaskSection(section.trim(), `task-${counter}`);
      if (task) {
        tasks.push(task);
      }
    }
  }

  // Clean up extra whitespace from removal
  cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();

  return { tasks, cleanedContent };
}

/**
 * Parse a single task section into a ParsedTask.
 */
function parseTaskSection(content: string, id: string): ParsedTask | null {
  if (!content.trim()) return null;

  const lines = content.split("\n");

  // Extract title from first line (e.g. "Task 1: Title here" or "### Task 1: Title")
  let title = "";
  let bodyStart = 0;
  const firstLine = lines[0].replace(/^#+\s*/, "").trim();
  const titleMatch = firstLine.match(/^Task\s+\d+[:\s]+(.+)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
    bodyStart = 1;
  } else {
    // Use first line as title
    title = firstLine;
    bodyStart = 1;
  }

  const body = lines.slice(bodyStart).join("\n").trim();

  // Extract sections from body
  const objective = extractSection(body, "Objective");
  const scope = extractSection(body, "Scope");
  const definitionOfDone = extractSection(body, "Definition of Done") || extractSection(body, "Acceptance Criteria");

  return {
    id,
    title,
    objective,
    scope,
    definitionOfDone,
    rawContent: content,
    status: "pending",
  };
}

/**
 * Extract a named section from markdown content.
 * Looks for "SectionName" or "**SectionName**" followed by content until next section.
 */
function extractSection(content: string, sectionName: string): string {
  // Match section header (with optional bold/heading markers)
  const pattern = new RegExp(
    `(?:^|\\n)(?:#+\\s*)?(?:\\*\\*)?${sectionName}(?:\\*\\*)?[:\\s]*\\n([\\s\\S]*?)(?=(?:\\n(?:#+\\s*)?(?:\\*\\*)?(?:Objective|Scope|Definition of Done|Acceptance Criteria|不包含|包含)(?:\\*\\*)?[:\\s]*\\n)|$)`,
    "i"
  );
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}
