---
title: i18n Implementation Guide
---

# 国际化 (i18n) 实现指南

> 基于 PR #174 的实现经验总结

## 概述

本项目采用自定义 i18n 方案，基于 React Context 实现，支持中英文双语切换。

### 核心特性

- **轻量级**: 无需第三方 i18n 库
- **类型安全**: 完整的 TypeScript 类型定义
- **持久化**: 语言偏好保存在 localStorage
- **自动检测**: 根据浏览器语言自动选择默认语言
- **测试保障**: 翻译键值对齐和完整性测试

## 目录结构

```
src/i18n/
├── __tests__/
│   └── i18n.test.ts       # 翻译完整性测试
├── locales/
│   ├── en.ts              # 英文翻译
│   └── zh.ts              # 中文翻译
├── context.tsx            # I18nContext Provider
├── types.ts               # 类型定义和常量
├── use-translation.ts     # useTranslation Hook
└── index.ts               # 统一导出
```

## 核心实现

### 1. 类型定义 (types.ts)

```typescript
// 支持的语言类型
export type Locale = "en" | "zh";

// 支持的语言列表
export const SUPPORTED_LOCALES: Locale[] = ["en", "zh"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "routa.locale";

// 翻译字典接口 - 按功能模块分组
export interface TranslationDictionary {
  common: { /* 通用文本 */ };
  home: { /* 首页文本 */ };
  nav: { /* 导航文本 */ };
  settings: { /* 设置文本 */ };
  // ... 更多模块
}
```

### 2. Context Provider (context.tsx)

```typescript
// 核心功能：
// 1. 语言状态管理
// 2. localStorage 持久化
// 3. 浏览器语言检测
// 4. HTML lang 属性更新

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = loadStoredLocale();
    return stored ?? detectBrowserLocale();
  });

  // 切换语言并持久化
  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
  }, []);

  // 更新 HTML lang 属性
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nContext value={{ locale, setLocale, t: dictionaries[locale] }}>
      {children}
    </I18nContext>
  );
}
```

### 3. 使用 Hook (use-translation.ts)

```typescript
"use client";

import { use } from "react";
import { I18nContext, type I18nContextValue } from "./context";

export function useTranslation(): I18nContextValue {
  return use(I18nContext);
}
```

## 在不同文件中使用

### 1. 客户端组件 ("use client")

```typescript
"use client";

import { useTranslation } from "@/i18n";

export function MyComponent() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <div>
      <h1>{t.home.title}</h1>
      <p>{t.common.loading}</p>
      <button onClick={() => setLocale("zh")}>切换中文</button>
    </div>
  );
}
```

### 2. 服务端组件 (Server Component)

> ⚠️ **限制**: 服务端组件无法使用 `useTranslation` Hook

```typescript
// ❌ 错误 - 服务端组件不能使用 Hook
import { useTranslation } from "@/i18n";

export default function ServerPage() {
  const { t } = useTranslation(); // 报错！
  return <div>{t.home.title}</div>;
}

// ✅ 方案1 - 直接导入翻译字典（仅默认语言）
import en from "@/i18n/locales/en";

export default function ServerPage() {
  return <div>{en.home.title}</div>;
}

// ✅ 方案2 - 将需要翻译的部分提取到客户端组件
import { ClientTitle } from "./client-title";

export default function ServerPage() {
  return (
    <div>
      <ClientTitle />  {/* 客户端组件，可使用 useTranslation */}
      <div>Static content</div>
    </div>
  );
}
```

### 3. 自定义 Hook 中使用

```typescript
// src/client/hooks/use-translated-error.ts
"use client";

import { useTranslation } from "@/i18n";

export function useTranslatedError() {
  const { t } = useTranslation();

  const getErrorMessage = (code: string): string => {
    const errorMap: Record<string, string> = {
      SAVE_FAILED: t.errors.saveFailed,
      LOAD_FAILED: t.errors.loadFailed,
      GENERIC: t.errors.generic,
    };
    return errorMap[code] ?? t.errors.generic;
  };

  return { getErrorMessage };
}
```

### 4. 工具函数中使用

```typescript
// ❌ 错误 - 工具函数不能使用 Hook
// src/lib/format-message.ts
import { useTranslation } from "@/i18n";

export function formatMessage(key: string) {
  const { t } = useTranslation(); // 报错！Hook 只能在组件/Hook 中使用
  return t.common[key];
}

// ✅ 方案 - 接收翻译对象作为参数
// src/lib/format-message.ts
import type { TranslationDictionary } from "@/i18n";

export function formatMessage(
  t: TranslationDictionary,
  key: string
): string {
  return t.common[key as keyof typeof t.common];
}

// 调用时传入 t
function Component() {
  const { t } = useTranslation();
  const msg = formatMessage(t, "save");
}
```

### 5. 类型文件中导入类型

```typescript
// src/types/i18n-types.ts
// ✅ 仅导入类型，无运行时依赖
import type { Locale, TranslationDictionary } from "@/i18n";

export interface UserPreference {
  locale: Locale;
  // ...
}

export function validateLocale(locale: string): locale is Locale {
  return ["en", "zh"].includes(locale);
}
```

### 6. 常量/配置文件

```typescript
// src/config/app-config.ts
// ✅ 直接导入翻译字典用于静态配置
import en from "@/i18n/locales/en";

export const APP_CONFIG = {
  defaultTitle: en.home.heroTitle,
  defaultDescription: en.home.heroDescription,
  // 注意：这里使用的是固定语言，不会动态切换
};
```

### 7. 测试文件中 Mock

```typescript
// src/components/__tests__/my-component.test.tsx
import { render, screen } from "@testing-library/react";
import { MyComponent } from "../my-component";

// Mock i18n
vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      home: { title: "Test Title" },
      common: { save: "Save" },
    },
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

describe("MyComponent", () => {
  it("renders translated text", () => {
    render(<MyComponent />);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });
});
```

### 8. API 路由中使用

```typescript
// src/app/api/translate/route.ts
// ✅ API 路由中直接导入字典
import { dictionaries } from "@/i18n/locales";
import type { Locale } from "@/i18n";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locale = (searchParams.get("locale") ?? "en") as Locale;
  const key = searchParams.get("key");

  const dict = dictionaries[locale];
  // 根据 key 路径获取翻译值
  // ...

  return Response.json({ value: "translated text" });
}
```

## 导入路径规范

```typescript
// ✅ 推荐 - 从统一入口导入
import { useTranslation, type Locale, type TranslationDictionary } from "@/i18n";

// ⚠️ 特殊情况 - 服务端/工具函数直接导入字典
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";

// ❌ 避免 - 直接导入内部模块
import { I18nContext } from "@/i18n/context";  // 内部实现
import { DEFAULT_LOCALE } from "@/i18n/types"; // 应从入口导入
```

## 翻译键命名规范

```
t.<模块>.<键名>

示例：
- t.common.save          → 通用操作
- t.home.subtitle        → 首页内容
- t.settings.title       → 设置页面
- t.notifications.empty  → 通知组件
```

## 添加新语言

### 步骤 1: 扩展 Locale 类型

```typescript
// types.ts
export type Locale = "en" | "zh" | "ja"; // 添加日语
export const SUPPORTED_LOCALES: Locale[] = ["en", "zh", "ja"];
```

### 步骤 2: 创建翻译文件

```typescript
// locales/ja.ts
import type { TranslationDictionary } from "../types";

const ja: TranslationDictionary = {
  common: {
    save: "保存",
    cancel: "キャンセル",
    // ...
  },
  // ... 完整翻译
};

export default ja;
```

### 步骤 3: 注册翻译字典

```typescript
// context.tsx
import ja from "./locales/ja";

const dictionaries: Record<Locale, TranslationDictionary> = { en, zh, ja };
```

### 步骤 4: 更新语言检测逻辑

```typescript
function detectBrowserLocale(): Locale {
  const lang = navigator.language?.toLowerCase() ?? "";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ja")) return "ja"; // 添加日语检测
  return DEFAULT_LOCALE;
}
```

## 添加新翻译键

### 步骤 1: 更新类型定义

```typescript
// types.ts
export interface TranslationDictionary {
  common: {
    // 新增键
    export: string;
  };
}
```

### 步骤 2: 在所有语言文件中添加翻译

```typescript
// locales/en.ts
common: {
  export: "Export",
}

// locales/zh.ts
common: {
  export: "导出",
}
```

### 步骤 3: 在组件中使用

```typescript
<button>{t.common.export}</button>
```

## 测试策略

### 翻译完整性测试

```typescript
// __tests__/i18n.test.ts

describe("i18n translations", () => {
  // 1. 验证默认语言
  it("should have en as default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  // 2. 验证所有语言键一致
  it("zh should have the same keys as en", () => {
    const enKeys = collectKeys(en).sort();
    const zhKeys = collectKeys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  // 3. 验证翻译值非空
  it("all translation values should be non-empty strings", () => {
    checkNonEmpty(en, "en");
    checkNonEmpty(zh, "zh");
  });
});
```

### 运行测试

```bash
npm test -- i18n
```

## 语言切换器组件

```typescript
// components/language-switcher.tsx
"use client";

import { useTranslation, SUPPORTED_LOCALES, type Locale } from "@/i18n";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center gap-0.5">
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          onClick={() => setLocale(loc)}
          className={locale === loc ? "active" : ""}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
```

## 根布局集成

```typescript
// app/layout.tsx
import { I18nProvider } from "@/i18n";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
```

## 最佳实践

### 1. 翻译键命名

- 使用驼峰命名法 (camelCase)
- 按功能模块分组
- 键名应清晰描述内容

```typescript
// ✅ 推荐
t.home.heroTitle
t.settings.language
t.errors.saveFailed

// ❌ 避免
t.home.title1
t.settings.text
t.errors.error1
```

### 2. 翻译文本规范

- **简洁**: 保持文本简短
- **一致**: 相同概念使用相同翻译
- **上下文**: 考虑文本出现位置

```typescript
// ✅ 推荐
heroTitle: "Start with a requirement."
loadingWorkspaces: "Loading workspaces..."

// ❌ 避免
heroTitle: "This is the hero title of the homepage which suggests users to start with a requirement description..."
```

### 3. 动态内容处理

```typescript
// ✅ 使用模板字符串
const message = `${t.home.workspaceCount}: ${count}`;

// ❌ 不要在翻译键中包含动态值
t.home.workspaceCount5  // 错误
```

### 4. 翻译文件维护

1. **保持同步**: 添加新键时同时更新所有语言文件
2. **运行测试**: 提交前运行 `npm test -- i18n`
3. **代码审查**: PR 时检查翻译完整性

## 常见问题

### Q: 为什么不使用 next-intl 或 react-i18next?

**A:** 本项目需求简单，自定义方案:
- 更轻量 (无额外依赖)
- 更灵活 (完全控制)
- 类型安全 (TypeScript 原生支持)

### Q: 如何处理复数形式?

**A:** 当前方案不支持复数，需要:
```typescript
// 简单处理
count === 1 ? t.item : t.items

// 或添加专门的键
t.item_one / t.item_other
```

### Q: 如何支持日期/数字格式化?

**A:** 使用 Intl API:
```typescript
new Intl.DateTimeFormat(locale).format(date);
new Intl.NumberFormat(locale).format(number);
```

## 迁移现有代码

### 步骤清单

1. **识别硬编码文本**: 搜索 UI 中的英文字符串
2. **添加翻译键**: 在 types.ts 中定义
3. **添加翻译值**: 在 en.ts 和 zh.ts 中填写
4. **替换硬编码**: 用 `t.xxx` 替换
5. **运行测试**: 确保没有遗漏

### 示例迁移

```typescript
// 迁移前
<button>Save</button>

// 迁移后
<button>{t.common.save}</button>
```

## 参考资料

- [PR #174: feat: add i18n support](https://github.com/phodal/routa/pull/174)
- [MDN: Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [React Context 文档](https://react.dev/reference/react/useContext)
