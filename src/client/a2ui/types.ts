/**
 * A2UI v0.10 Protocol Types
 *
 * Based on https://a2ui.org/specification/v0_10/
 * Declarative, JSON-based UI protocol for agent-generated interfaces.
 */

// ─── Dynamic value types ──────────────────────────────────────────

export interface DataBinding {
  path: string;
}

export interface FunctionCall {
  call: string;
  args: Record<string, unknown>;
  returnType: "string" | "number" | "boolean" | "array" | "object" | "any" | "void";
}

export type DynamicString = string | DataBinding | FunctionCall;
export type DynamicNumber = number | DataBinding | FunctionCall;
export type DynamicBoolean = boolean | DataBinding | FunctionCall;
export type DynamicValue = string | number | boolean | unknown[] | DataBinding | FunctionCall;
export type DynamicStringList = string[] | DataBinding | FunctionCall;

// ─── Component references ─────────────────────────────────────────

/** Static list of child component IDs, or a template-based dynamic list */
export type ChildList = string[] | { componentId: string; path: string };

/** Action triggered by a button or other interactive component */
export type A2UIAction =
  | { event: { name: string; context?: Record<string, DynamicValue> } }
  | { functionCall: FunctionCall };

/** Validation check rule */
export interface CheckRule {
  condition: FunctionCall;
  message: string;
}

// ─── Component definitions ────────────────────────────────────────

export type TextVariant = "h1" | "h2" | "h3" | "h4" | "h5" | "body" | "caption";
export type ImageVariant = "icon" | "avatar" | "smallFeature" | "mediumFeature" | "largeFeature" | "header";
export type ImageFit = "contain" | "cover" | "fill" | "none" | "scaleDown";
export type JustifyContent = "start" | "center" | "end" | "spaceBetween" | "spaceAround" | "spaceEvenly" | "stretch";
export type AlignItems = "start" | "center" | "end" | "stretch";
export type ButtonVariant = "default" | "primary" | "borderless";
export type TextFieldVariant = "shortText" | "longText" | "number" | "obscured";
export type ChoiceVariant = "mutuallyExclusive" | "multipleSelection";
export type ChoiceDisplayStyle = "checkbox" | "chips";

/** Base properties shared by all components */
export interface BaseComponentProps {
  id: string;
  weight?: number;
  accessibility?: {
    label?: string;
    description?: string;
  };
}

// ─── Named component types (flat spec format, v0.10) ──────────────

export interface TextComponent extends BaseComponentProps {
  component: "Text";
  text: DynamicString;
  variant?: TextVariant;
}

export interface ImageComponent extends BaseComponentProps {
  component: "Image";
  url: DynamicString;
  fit?: ImageFit;
  variant?: ImageVariant;
}

export interface IconComponent extends BaseComponentProps {
  component: "Icon";
  name: DynamicString;
}

export interface VideoComponent extends BaseComponentProps {
  component: "Video";
  url: DynamicString;
}

export interface AudioPlayerComponent extends BaseComponentProps {
  component: "AudioPlayer";
  url: DynamicString;
  description?: DynamicString;
}

export interface RowComponent extends BaseComponentProps {
  component: "Row";
  children: ChildList;
  justify?: JustifyContent;
  align?: AlignItems;
}

export interface ColumnComponent extends BaseComponentProps {
  component: "Column";
  children: ChildList;
  justify?: JustifyContent;
  align?: AlignItems;
}

export interface ListComponent extends BaseComponentProps {
  component: "List";
  children: ChildList;
  direction?: "vertical" | "horizontal";
  align?: AlignItems;
}

export interface CardComponent extends BaseComponentProps {
  component: "Card";
  child: string;
}

export interface TabsComponent extends BaseComponentProps {
  component: "Tabs";
  tabs: Array<{ title: DynamicString; child: string }>;
}

export interface ModalComponent extends BaseComponentProps {
  component: "Modal";
  trigger: string;
  content: string;
}

export interface DividerComponent extends BaseComponentProps {
  component: "Divider";
  axis?: "horizontal" | "vertical";
}

export interface ButtonComponent extends BaseComponentProps {
  component: "Button";
  child: string;
  variant?: ButtonVariant;
  action?: A2UIAction;
  checks?: CheckRule[];
}

export interface TextFieldComponent extends BaseComponentProps {
  component: "TextField";
  label?: DynamicString;
  value?: DynamicString;
  variant?: TextFieldVariant;
  checks?: CheckRule[];
}

export interface CheckBoxComponent extends BaseComponentProps {
  component: "CheckBox";
  label?: DynamicString;
  value?: DynamicBoolean;
  checks?: CheckRule[];
}

export interface ChoicePickerComponent extends BaseComponentProps {
  component: "ChoicePicker";
  options: Array<{ label: DynamicString; value: string }>;
  value?: DynamicStringList;
  variant?: ChoiceVariant;
  displayStyle?: ChoiceDisplayStyle;
  filterable?: boolean;
}

export interface SliderComponent extends BaseComponentProps {
  component: "Slider";
  label?: DynamicString;
  value?: DynamicNumber;
  min?: number;
  max?: number;
  checks?: CheckRule[];
}

export interface DateTimeInputComponent extends BaseComponentProps {
  component: "DateTimeInput";
  value?: DynamicString;
  enableDate?: boolean;
  enableTime?: boolean;
  min?: string;
  max?: string;
  label?: DynamicString;
}

/** Union of all A2UI component types */
export type A2UIComponent =
  | TextComponent
  | ImageComponent
  | IconComponent
  | VideoComponent
  | AudioPlayerComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | CardComponent
  | TabsComponent
  | ModalComponent
  | DividerComponent
  | ButtonComponent
  | TextFieldComponent
  | CheckBoxComponent
  | ChoicePickerComponent
  | SliderComponent
  | DateTimeInputComponent;

// ─── Protocol messages ────────────────────────────────────────────

export interface CreateSurfaceMessage {
  version: "v0.10";
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: {
      primaryColor?: string;
      iconUrl?: string;
      agentDisplayName?: string;
    };
    sendDataModel?: boolean;
  };
}

export interface UpdateComponentsMessage {
  version: "v0.10";
  updateComponents: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: "v0.10";
  updateDataModel: {
    surfaceId: string;
    path?: string;
    value?: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: "v0.10";
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

// ─── Client → Server messages ─────────────────────────────────────

export interface A2UIActionMessage {
  version: "v0.10";
  action: {
    name: string;
    surfaceId: string;
    sourceComponentId?: string;
    timestamp: string;
    context?: Record<string, unknown>;
  };
}

// ─── Surface state (client-side) ──────────────────────────────────

export interface A2UISurface {
  surfaceId: string;
  catalogId: string;
  theme?: {
    primaryColor?: string;
    iconUrl?: string;
    agentDisplayName?: string;
  };
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
  rootId?: string;
}

// ─── Convenience: full A2UI response payload ──────────────────────

export interface A2UIResponse {
  surfaces: A2UISurface[];
  messages: A2UIMessage[];
}
