"use client";

import React from "react";

interface HarnessMarkProps {
  className?: string;
  title?: string;
}

/**
 * Minimal mono mark for Harness:
 * a restrained frame, three aligned pillars, and one control-loop stroke.
 */
export function HarnessMark({
  className = "h-5 w-5",
  title = "Harness",
}: HarnessMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <path
        d="M5.75 7V17"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.52"
      />
      <path
        d="M5.75 7H10.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.52"
      />
      <path
        d="M5.75 17H10.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.52"
      />
      <path
        d="M9 10V15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.25V15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 11V15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.25 9C17.25 6.93 15.57 5.25 13.5 5.25H11.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.25 3.95L8.95 5.25L10.25 6.55"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.25 9.75V17.25H16.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.58"
      />
      <circle cx="9" cy="17.1" r="0.95" fill="currentColor" opacity="0.82" />
      <circle cx="12" cy="17.1" r="0.95" fill="currentColor" opacity="0.92" />
      <circle cx="15" cy="17.1" r="0.95" fill="currentColor" />
    </svg>
  );
}
