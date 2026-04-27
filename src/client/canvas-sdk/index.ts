/**
 * Canvas SDK — constrained React component library for canvas artifacts.
 *
 * Components use inline styles with theme tokens. Import only from this barrel.
 */

// Theme
export {
  type CanvasTheme,
  type CanvasTokens,
  type CanvasPalette,
  darkTheme,
  lightTheme,
  canvasPaletteDark,
  canvasPaletteLight,
  canvasTokens,
  canvasTokensLight,
  canvasSpacing,
  canvasRadius,
  canvasTypography,
} from "./tokens";

export {
  CanvasThemeProvider,
  useHostTheme,
  type CanvasHostTheme,
} from "./theme-context";

// Host state hooks
export {
  useCanvasState,
  useCanvasAction,
  type CanvasAction,
  type SetCanvasState,
} from "./hooks";

// Primitives (layout + typography)
export {
  mergeStyle,
  Stack,
  Row,
  Grid,
  Divider,
  Spacer,
  Text,
  H1,
  H2,
  H3,
  Code,
  Link,
  type StackProps,
  type RowProps,
  type GridProps,
  type DividerProps,
  type TextWeight,
  type TextProps,
  type H1Props,
  type H2Props,
  type H3Props,
  type CodeProps,
  type LinkProps,
} from "./primitives";

// Data display
export {
  Table,
  Stat,
  Pill,
  Callout,
  type TableProps,
  type TableColumnAlign,
  type TableRowTone,
  type StatProps,
  type StatTone,
  type PillProps,
  type PillTone,
  type PillSize,
  type CalloutProps,
  type CalloutTone,
} from "./data-display";

// Containers
export {
  Card,
  CardHeader,
  CardBody,
  type CardProps,
  type CardSize,
  type CardVariant,
  type CardHeaderProps,
  type CardBodyProps,
} from "./containers";

// Controls
export {
  Button,
  TextInput,
  TextArea,
  Checkbox,
  Toggle,
  Select,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type TextInputProps,
  type TextAreaProps,
  type CheckboxProps,
  type ToggleProps,
  type SelectOption,
  type SelectProps,
  type IconButtonProps,
} from "./controls";

// Charts
export {
  BarChart,
  LineChart,
  PieChart,
  type BarChartProps,
  type BarChartEntry,
  type ChartDataPoint,
  type ChartSeries,
  type ChartTone,
  type LineChartProps,
  type PieChartProps,
  type PieChartEntry,
} from "./charts";

// Diff rendering
export {
  DiffStats,
  DiffView,
  type DiffStatsProps,
  type DiffLineType,
  type DiffLineData,
  type DiffViewProps,
} from "./diff-view";

// DAG layout
export {
  computeDAGLayout,
  type DAGLayoutOptions,
  type DAGLayoutNode,
  type DAGLayoutEdge,
  type DAGLayoutRank,
  type DAGLayoutResult,
} from "./dag-layout";
