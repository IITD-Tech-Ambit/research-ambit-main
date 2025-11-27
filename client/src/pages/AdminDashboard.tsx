import { useState } from "react";
import { Device, DUMMY_DEVICES } from "@/data/dummyData";
import { DeviceRow } from "@/components/DeviceRow";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Activity } from "lucide-react";
import { Footer } from "@/components/Footer";

const AdminDashboard = () => {
  const [devices, setDevices] = useState<Device[]>(DUMMY_DEVICES);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  const handleToggleExpand = (deviceId: string) => {
    console.log("📋 Device Row Toggle", {
      deviceId,
      action: expandedDevice === deviceId ? "collapse" : "expand",
      timestamp: new Date().toISOString(),
    });
    setExpandedDevice(expandedDevice === deviceId ? null : deviceId);
  };

  const updateDevice = (deviceId: string, updates: Partial<Device>) => {
    setDevices((prev) =>
      prev.map((device) =>
        device.deviceId === deviceId ? { ...device, ...updates } : device
      )
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
          Infusion Pump Dashboard
        </h1>
        <p className="text-muted-foreground">
          Monitor and manage all hospital infusion pumps
        </p>
      </div>

      <Card className="glass border-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <CardTitle>Device Metrics</CardTitle>
              <CardDescription>
                Real-time status of all infusion pumps
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {devices.map((device) => (
              <DeviceRow
                key={device.deviceId}
                device={device}
                expanded={expandedDevice === device.deviceId}
                onToggleExpand={handleToggleExpand}
                onUpdateDevice={updateDevice}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Status Legend */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Status Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Healthy - Ready for use</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse-glow"></div>
              <span>Running - Active infusion</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-600"></div>
              <span>Issue - Requires attention</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span>Degraded - Offline/Error</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Footer />
    </div>
  );
};

export default AdminDashboard;
