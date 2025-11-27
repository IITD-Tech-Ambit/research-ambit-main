import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface ConfirmActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "pause" | "resume" | "stop";
  deviceId: string;
  onConfirm: () => void;
}

export const ConfirmActionModal = ({
  open,
  onOpenChange,
  action,
  deviceId,
  onConfirm,
}: ConfirmActionModalProps) => {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmText("");
    }
  }, [open]);

  const handleConfirm = () => {
    if (confirmText.toLowerCase() === action) {
      onConfirm();
      setConfirmText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
  };

  const getActionColor = () => {
    switch (action) {
      case "stop":
        return "text-destructive";
      case "pause":
        return "text-orange-600";
      case "resume":
        return "text-primary";
      default:
        return "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass w-[95vw] max-w-md bg-gradient-to-br from-primary/5 via-background to-secondary/10 p-4 sm:p-6 rounded-2xl border-0">
        <DialogHeader>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-muted rounded-lg">
              <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600" />
            </div>
            <DialogTitle className="text-lg sm:text-xl">
              Confirm {action.charAt(0).toUpperCase() + action.slice(1)}
            </DialogTitle>
          </div>
          <DialogDescription className="pt-3 sm:pt-4 text-sm sm:text-base">
            You are about to{" "}
            <span className={`font-semibold ${getActionColor()}`}>
              {action}
            </span>{" "}
            the infusion on device{" "}
            <span className="font-mono font-semibold">{deviceId}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
          <div className="space-y-2">
            <Label htmlFor="confirm-text" className="text-sm sm:text-base">
              Type{" "}
              <span className="font-mono font-bold">&quot;{action}&quot;</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Type "${action}" here`}
              className="h-10 sm:h-12 text-sm sm:text-base"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={confirmText.toLowerCase() !== action}
            variant={action === "stop" ? "destructive" : "default"}
            className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
          >
            Confirm {action.charAt(0).toUpperCase() + action.slice(1)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
