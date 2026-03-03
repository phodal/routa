/**
 * A2UI Module — Agent-to-User Interface
 *
 * Provides types, renderer, and dashboard generator for the A2UI v0.10 protocol.
 * See https://a2ui.org/ for the full specification.
 */

export * from "./types";
export { A2UIViewer, A2UISurfaceRenderer, processA2UIMessages } from "./renderer";
export { generateDashboardA2UI, generateCustomSurfaceA2UI } from "./dashboard-generator";
export type { DashboardData } from "./dashboard-generator";
