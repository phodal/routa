/**
 * Canvas Runtime — host contract for mounting and rendering canvas artifacts.
 */

export { CanvasHost, mountCanvas, type CanvasHostProps } from "./mount";
export { CanvasErrorBoundary } from "./error-boundary";
export {
  compileCanvasTsx,
  type CompileResult,
  type CompileError,
  type CompileOutcome,
} from "./compiler";
