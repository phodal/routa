"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SettingsPanel } from "@/client/components/settings-panel";

interface ProviderOption {
  id: string;
  name: string;
  status?: string;
}

export function SettingsPageClient() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const res = await fetch("/api/providers");
        if (res.ok) {
          const data = await res.json();
          setProviders(data.providers ?? []);
        }
      } catch (error) {
        console.error("Failed to fetch providers:", error);
      }
    };

    void fetchProviders();
  }, []);

  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#0f1117]">
      <SettingsPanel
        open={true}
        onClose={handleClose}
        providers={providers}
      />
    </div>
  );
}
