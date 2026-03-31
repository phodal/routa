"use client";

import { useEffect, useState, useRef } from "react";
import { useTranslation } from "@/i18n";

export type HarnessNavSection = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

type HarnessFloatingNavProps = {
  sections: HarnessNavSection[];
};

export function HarnessFloatingNav({ sections }: HarnessFloatingNavProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // 监听滚动，高亮当前可见的 section
  useEffect(() => {
    // 找到实际的滚动容器（带有 overflow-y-auto 的 main 标签）
    const scrollContainer = document.querySelector("main.overflow-y-auto");
    if (!scrollContainer) return;

    function handleScroll() {
      if (!scrollContainer) return;

      const sectionElements = sections
        .map(s => ({ id: s.id, element: document.getElementById(s.id) }))
        .filter(item => item.element !== null);

      let currentActive: string | null = null;
      const containerRect = scrollContainer.getBoundingClientRect();
      const scrollTop = scrollContainer.scrollTop;

      for (const { id, element } of sectionElements) {
        if (element) {
          const rect = element.getBoundingClientRect();
          // 计算元素相对于滚动容器的位置
          const elementTop = rect.top - containerRect.top + scrollTop;

          if (scrollTop + 100 >= elementTop) { // 100px offset from top
            currentActive = id;
          }
        }
      }

      setActiveSection(currentActive);
    }

    scrollContainer.addEventListener("scroll", handleScroll);
    handleScroll(); // 初始化

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [sections]);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    const scrollContainer = document.querySelector("main.overflow-y-auto");

    if (element && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const scrollTop = scrollContainer.scrollTop;

      // 计算目标滚动位置
      const targetScrollTop = elementRect.top - containerRect.top + scrollTop - 80; // 80px offset

      scrollContainer.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      setIsOpen(false);
    }
  };

  return (
    <div ref={menuRef} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {/* 展开的菜单项 */}
      {isOpen && (
        <div className="mb-2 rounded-2xl border border-desktop-border bg-white/95 shadow-2xl backdrop-blur-sm dark:bg-[#1a1d2e]/95">
          <div className="max-h-[60vh] min-w-55 overflow-y-auto p-2">
            <div className="mb-2 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                {t.settings.harness.quickNavigation}
              </div>
            </div>
            <div className="space-y-0.5">
              {sections.map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] transition-colors ${
                      isActive
                        ? "bg-desktop-accent/10 font-semibold text-desktop-accent"
                        : "text-desktop-text-primary hover:bg-desktop-bg-secondary/80"
                    }`}
                  >
                    {section.icon && (
                      <span className={isActive ? "text-desktop-accent" : "text-desktop-text-secondary"}>
                        {section.icon}
                      </span>
                    )}
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 浮动按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-desktop-border bg-white shadow-lg transition-all hover:scale-105 hover:shadow-xl dark:bg-[#1a1d2e]"
        aria-label={isOpen ? t.settings.harness.collapseNavigation : t.settings.harness.expandNavigation}
      >
        <svg
          className={`h-5 w-5 text-desktop-text-primary transition-transform ${
            isOpen ? "rotate-0" : "rotate-180"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}

