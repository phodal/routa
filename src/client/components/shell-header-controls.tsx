"use client";

import { ProtocolBadge } from "@/app/protocol-badge";

import { DockerStatusIndicator } from "./docker-status-indicator";
import { SettingsPopupMenu } from "./settings-popup-menu";
import { McpStatusIndicator } from "./mcp-status-indicator";


interface ShellHeaderControlsProps {
  className?: string;
  showProtocolBadges?: boolean;
  showSettingsMenu?: boolean;
  compactStatus?: boolean;
}

export function ShellHeaderControls({
  className = "",
  showProtocolBadges = true,
  showSettingsMenu = true,
  compactStatus = false,
}: ShellHeaderControlsProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="hidden lg:flex">
        <DockerStatusIndicator compact={compactStatus} />
      </div>
      <div className="hidden lg:flex">
        <McpStatusIndicator compact={compactStatus} />
      </div>
      {showProtocolBadges ? (
        <div className="hidden lg:flex items-center gap-2">
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
        </div>
      ) : null}
      {showSettingsMenu ? <SettingsPopupMenu showLabel position="topbar" buttonClassName="h-8 gap-1" /> : null}
    </div>
  );
}
