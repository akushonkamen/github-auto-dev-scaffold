"use client";

import { useTransition } from "react";
import { setActiveInstallation } from "@/actions/active-installation";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface Props {
  installationId: number;
  accountLogin: string;
}

/**
 * "Set as active" button — writes the `gitautodev_active_installation` cookie
 * when clicked, so the app remembers which installation the user is working with.
 *
 * Uses React 18 `useTransition` for a pending state without blocking the UI.
 */
export function SetActiveButton({ installationId, accountLogin }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await setActiveInstallation(installationId);
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={handleClick}
      className="gap-1.5"
    >
      {!pending && <Check className="h-3.5 w-3.5" />}
      {pending ? "Setting…" : `Set ${accountLogin} as active`}
    </Button>
  );
}
