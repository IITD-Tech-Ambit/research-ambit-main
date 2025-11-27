import { AlertTriangle, X, Clock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface DeviceNotification {
  id: string;
  type: "error" | "warning" | "info" | "success";
  priority: "critical" | "warning" | "info";
  title: string;
  message: string;
  timestamp: string;
  deviceId: string;
  data?: Record<string, unknown>;
  showModal?: boolean;
}

interface ErrorModalProps {
  notification: DeviceNotification | null;
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge?: () => void;
}

export const ErrorModal = ({
  notification,
  isOpen,
  onClose,
  onAcknowledge,
}: ErrorModalProps) => {
  if (!notification) return null;

  const handleAcknowledge = () => {
    onAcknowledge?.();
    onClose();
  };

  const getPriorityIcon = () => {
    switch (notification.priority) {
      case "critical":
        return <AlertTriangle className="h-6 w-6 text-red-500" />;
      case "warning":
        return <AlertTriangle className="h-6 w-6 text-yellow-500" />;
      default:
        return <Info className="h-6 w-6 text-blue-500" />;
    }
  };

  const getPriorityColor = (): "destructive" | "secondary" | "outline" => {
    switch (notification.priority) {
      case "critical":
        return "destructive";
      case "warning":
        return "secondary";
      default:
        return "outline";
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getErrorDetails = () => {
    if (notification.data && typeof notification.data === "object") {
      const errorData = notification.data as {
        type?: string;
        severity?: string;
        details?: Record<string, unknown>;
        errorId?: string;
      };

      return {
        errorId: errorData.errorId || "Unknown",
        type: errorData.type || "Device Error",
        severity: errorData.severity || "medium",
        details: errorData.details,
      };
    }
    return null;
  };

  const errorDetails = getErrorDetails();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pb-4">
          <div className="flex items-center gap-3">
            {getPriorityIcon()}
            <div className="flex-1">
              <DialogTitle className="text-lg font-semibold">
                {notification.title}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={getPriorityColor()}>
                  {notification.priority.toUpperCase()}
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatTimestamp(notification.timestamp)}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Message */}
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm font-medium text-foreground">
              {notification.message}
            </p>
          </div>

          {/* Device Information */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Device:</span>
              <span className="ml-2 font-medium">{notification.deviceId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Type:</span>
              <span className="ml-2 font-medium">{notification.type}</span>
            </div>
          </div>

          {/* Error Details (if available from Redis) */}
          {errorDetails && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Error Details:</h4>
              <div className="p-3 rounded-lg bg-muted/30 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Error ID:</span>
                  <span className="font-mono">{errorDetails.errorId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Error Type:</span>
                  <span>{errorDetails.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Severity:</span>
                  <Badge variant="outline" className="text-xs">
                    {errorDetails.severity}
                  </Badge>
                </div>
                {errorDetails.details &&
                  Object.keys(errorDetails.details).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <span className="text-muted-foreground block mb-1">
                        Additional Details:
                      </span>
                      <pre className="text-xs bg-background p-2 rounded border overflow-auto max-h-20">
                        {JSON.stringify(errorDetails.details, null, 2)}
                      </pre>
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* Status Information */}
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Error cached for 5 minutes
              </span>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              This error is stored in Redis and will be available for
              troubleshooting for the next 5 minutes.
            </p>
          </div>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Close
          </Button>
          <Button
            onClick={handleAcknowledge}
            className="flex-1"
            variant={
              notification.priority === "critical" ? "destructive" : "default"
            }
          >
            OK - Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
