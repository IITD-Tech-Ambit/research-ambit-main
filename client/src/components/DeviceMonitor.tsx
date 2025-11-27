import React, { useEffect, useState } from "react";
import useDeviceStream from "@/hooks/useDeviceStream";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Activity, Wifi, WifiOff } from "lucide-react";

interface DeviceMonitorProps {
  deviceId: string;
  onBack?: () => void;
}

export const DeviceMonitor: React.FC<DeviceMonitorProps> = ({
  deviceId,
  onBack,
}) => {
  const {
    connectionStatus,
    isConnected,
    isConnecting,
    connectionError,
    deviceStatus,
    latestProgress,
    latestStatusUpdate,
    infusionRecovered,
    hasActiveInfusion,
    currentInfusionId,
    connectToDevice,
    disconnect,
    refreshStatus,
  } = useDeviceStream(deviceId, {
    autoConnect: true,
    autoRecover: true,
    baseUrl: "http://localhost:3000", // Configure based on environment
  });

  const [retryCount, setRetryCount] = useState(0);

  // Handle connection retry
  const handleRetry = async () => {
    setRetryCount((prev) => prev + 1);
    try {
      await connectToDevice(deviceId);
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  // Calculate progress percentage
  const getProgressPercentage = () => {
    if (!latestProgress || !deviceStatus?.currentInfusion) return 0;

    const plannedTime =
      deviceStatus.currentInfusion.parameters.plannedTimeMin || 0;
    const remainingTime = latestProgress.progress?.timeRemainingMin || 0;

    if (plannedTime === 0) return 0;
    return Math.max(
      0,
      Math.min(100, ((plannedTime - remainingTime) / plannedTime) * 100)
    );
  };

  // Format time remaining
  const formatTimeRemaining = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Activity className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p>Connecting to device {deviceId}...</p>
        </div>
      </div>
    );
  }

  if (!isConnected || connectionError) {
    return (
      <div className="p-6 text-center space-y-4">
        <div className="flex items-center justify-center space-x-2 text-destructive">
          <WifiOff className="h-6 w-6" />
          <span>Connection Failed</span>
        </div>

        {connectionError && (
          <p className="text-muted-foreground text-sm">{connectionError}</p>
        )}

        <div className="space-x-2">
          <Button onClick={handleRetry} variant="outline">
            Retry Connection {retryCount > 0 && `(${retryCount})`}
          </Button>
          {onBack && (
            <Button onClick={onBack} variant="secondary">
              Go Back
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Device Monitor</h1>
          <p className="text-muted-foreground">
            Monitoring device {deviceId}
            {infusionRecovered && (
              <Badge variant="secondary" className="ml-2">
                Session Recovered
              </Badge>
            )}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-green-600">
            <Wifi className="h-4 w-4" />
            <span className="text-sm">Connected</span>
          </div>
          {onBack && (
            <Button onClick={onBack} variant="outline" size="sm">
              Back
            </Button>
          )}
        </div>
      </div>

      {/* Device Status */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Device Status</h3>
            <p className="text-sm text-muted-foreground">
              Location: {deviceStatus?.device?.location || "Unknown"}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Badge
              variant={
                deviceStatus?.device?.status === "running"
                  ? "default"
                  : "secondary"
              }
            >
              {deviceStatus?.device?.status || "Unknown"}
            </Badge>
            <Button onClick={refreshStatus} variant="outline" size="sm">
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Active Infusion */}
      {hasActiveInfusion && deviceStatus?.currentInfusion && (
        <Card className="p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Active Infusion</h3>
              <Badge variant="default">
                ID: {currentInfusionId?.slice(-8)}
              </Badge>
            </div>

            {/* Progress Bar */}
            {latestProgress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{getProgressPercentage().toFixed(1)}%</span>
                </div>
                <Progress value={getProgressPercentage()} />
              </div>
            )}

            {/* Infusion Details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Flow Rate</p>
                <p className="font-semibold">
                  {deviceStatus.currentInfusion.parameters.flowRateMlMin} ml/min
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Planned Time</p>
                <p className="font-semibold">
                  {deviceStatus.currentInfusion.parameters.plannedTimeMin} min
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Planned Volume</p>
                <p className="font-semibold">
                  {deviceStatus.currentInfusion.parameters.plannedVolumeMl} ml
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="font-semibold">
                  {new Date(
                    deviceStatus.currentInfusion.startedAt
                  ).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Real-time Progress */}
            {latestProgress && (
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    {formatTimeRemaining(
                      latestProgress.progress?.timeRemainingMin || 0
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Time Remaining
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    {Math.round(
                      latestProgress.progress?.volumeRemainingMl || 0
                    )}{" "}
                    ml
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Volume Remaining
                  </p>
                </div>
              </div>
            )}

            {/* Last Update */}
            {latestProgress && (
              <div className="text-xs text-muted-foreground text-center">
                Last updated:{" "}
                {new Date(latestProgress.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* No Active Infusion */}
      {!hasActiveInfusion && (
        <Card className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No Active Infusion</h3>
          <p className="text-muted-foreground">
            This device is not currently running an infusion.
          </p>
        </Card>
      )}

      {/* Status Updates */}
      {latestStatusUpdate && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Latest Status Update</h3>
          <div className="text-sm space-y-1">
            <p>
              Status:{" "}
              <span className="font-semibold">{latestStatusUpdate.status}</span>
            </p>
            <p>
              Last Ping:{" "}
              {new Date(latestStatusUpdate.lastPing).toLocaleTimeString()}
            </p>
            <p className="text-muted-foreground">
              Updated:{" "}
              {new Date(latestStatusUpdate.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};

export default DeviceMonitor;
