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
  canvasSpacing,
  canvasRadius,
  canvasTypography,
} from "./tokens";

export {
  CanvasThemeProvider,
  useHostTheme,
  type CanvasHostTheme,
} from "./theme-context";

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
  type TableProps,
  type TableColumnAlign,
  type TableRowTone,
  type StatProps,
  type StatTone,
  type PillProps,
  type PillTone,
} from "./data-display";

// Containers
export {
  Card,
  CardHeader,
  CardBody,
  type CardProps,
  type CardHeaderProps,
  type CardBodyProps,
} from "./containers";

// Controls
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
} from "./controls";

// Charts
export {
  BarChart,
  PieChart,
  type BarChartProps,
  type BarChartEntry,
  type PieChartProps,
  type PieChartEntry,
} from "./charts";
