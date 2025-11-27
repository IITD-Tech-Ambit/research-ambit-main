import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useDeviceSocket } from "@/hooks/useDeviceSocket";

interface InfusionConfirmationData {
  deviceId: string;
  infusionId: string;
  status: string;
  timestamp: string;
}

interface WaitingForDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string;
  onDeviceConfirmed: (infusionData: InfusionConfirmationData) => void;
}

export const WaitingForDeviceModal = ({
  isOpen,
  onClose,
  deviceId,
  onDeviceConfirmed,
}: WaitingForDeviceModalProps) => {
  const [status, setStatus] = useState<"waiting" | "confirmed" | "error">(
    "waiting"
  );
  const [error, setError] = useState<string>("");
  const [connectionDetails, setConnectionDetails] = useState<string>("");

  const {
    isConnected,
    isConnecting,
    connectionError,
    infusionConfirmation,
    connect,
    subscribeToDevice,
    clearInfusionConfirmation,
  } = useDeviceSocket(deviceId, { autoConnect: false }); // Disable auto-connect to prevent conflicts

  useEffect(() => {
    if (!isOpen) {
      setStatus("waiting");
      setError("");
      setConnectionDetails("");
      return;
    }

    // Clear any previous infusion confirmation when modal opens
    clearInfusionConfirmation();

    // Auto-connect if not connected
    if (!isConnected && !isConnecting) {
      setConnectionDetails("Connecting to server...");
      connect().catch((err) => {
        console.error("Connection failed:", err);
        setStatus("error");
        setError(`Failed to connect to server: ${err.message}`);
      });
    }
  }, [isOpen, isConnected, isConnecting, connect, clearInfusionConfirmation]);

  // Monitor connection status
  useEffect(() => {
    if (isConnected) {
      setConnectionDetails(
        `Connected to server. Waiting for device ${deviceId}...`
      );
    } else if (isConnecting) {
      setConnectionDetails("Connecting to server...");
    } else if (connectionError) {
      setConnectionDetails(`Connection error: ${connectionError}`);
    }
  }, [isConnected, isConnecting, connectionError, deviceId]);

  // Listen for infusion confirmation from Socket.IO
  useEffect(() => {
    if (infusionConfirmation && status === "waiting") {
      console.log("✅ Received infusion confirmation:", infusionConfirmation);

      // Validate that this confirmation is for our device and has the required data
      if (infusionConfirmation.infusionId && infusionConfirmation.confirmed) {
        setStatus("confirmed");
        setConnectionDetails("Device confirmed! Processing...");

        setTimeout(() => {
          onDeviceConfirmed({
            deviceId,
            infusionId: infusionConfirmation.infusionId,
            status: "confirmed",
            timestamp:
              infusionConfirmation.confirmedAt || new Date().toISOString(),
          });

          // Refresh the page to get latest data
          window.location.reload();
        }, 1500);
      } else {
        console.warn(
          "⚠️ Received invalid infusion confirmation:",
          infusionConfirmation
        );
        setConnectionDetails(
          "Received invalid device response. Still waiting..."
        );
      }
    }
  }, [infusionConfirmation, status, deviceId, onDeviceConfirmed]);

  // Set up timeout for device response and subscribe to device
  useEffect(() => {
    if (isOpen && isConnected && status === "waiting") {
      // Subscribe to device events
      try {
        subscribeToDevice(deviceId);
        console.log(
          `📡 Subscribed to device ${deviceId} for infusion confirmation`
        );
        setConnectionDetails(
          `Subscribed to device ${deviceId}. Waiting for confirmation...`
        );
      } catch (err) {
        console.error("Subscription failed:", err);
        setStatus("error");
        setError(`Failed to subscribe to device: ${err.message}`);
        return;
      }

      // Set timeout for device response
      const timeoutId = setTimeout(() => {
        if (status === "waiting") {
          setStatus("error");
          setError(
            "Device did not respond within 30 seconds. Please check the device connection and try again."
          );
        }
      }, 30000);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [isOpen, isConnected, status, deviceId, subscribeToDevice]);

  // Handle connection errors
  useEffect(() => {
    if (connectionError && !isConnected) {
      setStatus("error");
      setError(`Connection error: ${connectionError}`);
    }
  }, [connectionError, isConnected]);

  const handleCancel = () => {
    // Refresh the page when modal closes to get latest data
    window.location.reload();
  };

  const handleRetry = () => {
    setStatus("waiting");
    setError("");
    setConnectionDetails("Retrying connection...");
    if (!isConnected) {
      connect().catch((err) => {
        console.error("Retry connection failed:", err);
        setStatus("error");
        setError(`Retry failed: ${err.message}`);
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            {status === "waiting" && "Waiting for Device Response"}
            {status === "confirmed" && "Device Confirmed!"}
            {status === "error" && "Connection Error"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          {(status === "waiting" || isConnecting) && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-center text-muted-foreground">
                {connectionDetails ||
                  `Waiting for device ${deviceId} to confirm the infusion...`}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Please ensure the device is connected and ready to receive
                commands.
              </p>
              {isConnected && (
                <div className="text-xs text-green-600 text-center">
                  ✅ Connected to server
                </div>
              )}
            </>
          )}

          {status === "confirmed" && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-center text-green-600 font-semibold">
                Device confirmed! Starting infusion monitoring...
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-center text-destructive font-semibold">
                Failed to connect to device
              </p>
              <p className="text-xs text-muted-foreground text-center">
                {error}
              </p>
            </>
          )}
        </div>

        <div className="flex justify-center space-x-3">
          {(status === "waiting" || isConnecting) && (
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          )}

          {status === "error" && (
            <>
              <Button variant="outline" onClick={handleCancel}>
                Close
              </Button>
              <Button onClick={handleRetry}>Retry</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
