import { useState } from "react";
import { Device, DUMMY_DEVICE_DIRECTORY } from "@/data/dummyData";
import { StatusChip } from "./StatusChip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Play, Calendar, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunningDeviceActions } from "./RunningDeviceActions";
import { IdleDeviceActions } from "./IdleDeviceActions";

interface DeviceRowProps {
  device: Device;
  expanded: boolean;
  onToggleExpand: (deviceId: string) => void;
  onUpdateDevice: (deviceId: string, updates: Partial<Device>) => void;
}

export const DeviceRow = ({
  device,
  expanded,
  onToggleExpand,
  onUpdateDevice,
}: DeviceRowProps) => {
  // Helper function to get device location
  const getDeviceLocation = (deviceId: string) => {
    const deviceInfo = DUMMY_DEVICE_DIRECTORY.find(
      (d) => d.deviceId === deviceId
    );
    return deviceInfo?.location || "Unknown Location";
  };

  return (
    <div className="border rounded-xl overflow-hidden transition-all hover:shadow-md bg-card">
      {/* Collapsed Row */}
      <button
        onClick={() => onToggleExpand(device.deviceId)}
        className="w-full p-3 sm:p-4 hover:bg-accent/50 transition-colors"
      >
        {/* Mobile Layout (stacked) */}
        <div className="flex flex-col gap-2 sm:hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono font-semibold text-sm">
              {device.deviceId}
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center justify-between">
            <StatusChip
              status={device.status}
              showPulse={device.status === "Running"}
            />
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="text-xs truncate max-w-[120px]">
                {getDeviceLocation(device.deviceId)}
              </span>
            </div>
          </div>
        </div>

        {/* Desktop/Tablet Layout (horizontal) */}
        <div className="hidden sm:flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-6 lg:gap-8 flex-1 min-w-0">
            <span className="font-mono font-semibold text-sm md:text-base whitespace-nowrap">
              {device.deviceId}
            </span>
            <StatusChip
              status={device.status}
              showPulse={device.status === "Running"}
            />

            {/* Location Display */}
            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
              <MapPin className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm truncate">
                {getDeviceLocation(device.deviceId)}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t bg-muted/30 p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 animate-accordion-down">
          <Card className="glass-dark">
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Device ID
                </p>
                <p className="font-mono font-semibold text-sm sm:text-base">
                  {device.deviceId}
                </p>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Location
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
                  <p className="font-semibold text-sm sm:text-base truncate">
                    {getDeviceLocation(device.deviceId)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Infusions Completed
                </p>
                <p className="font-semibold text-sm sm:text-base">
                  {device.infusionsCompleted}
                </p>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Current Status
                </p>
                <div className="mt-1">
                  <StatusChip
                    status={device.status}
                    showPulse={device.status === "Running"}
                  />
                </div>
              </div>
            </div>
          </Card>

          {device.status === "Degraded" && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground bg-destructive/10 p-2 sm:p-3 rounded-lg">
              <span className="text-destructive font-medium">Last online:</span>
              <span className="break-all sm:break-normal">
                {new Date(device.lastOnline).toLocaleString()}
              </span>
            </div>
          )}

          {/* Actions based on status */}
          <div className="space-y-3 sm:space-y-4">
            {device.status === "Running" ? (
              <RunningDeviceActions
                device={device}
                onUpdateDevice={onUpdateDevice}
              />
            ) : (
              <IdleDeviceActions
                device={device}
                onUpdateDevice={onUpdateDevice}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
