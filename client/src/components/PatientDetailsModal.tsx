import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Device } from "@/data/dummyData";
import { User, Syringe, Clock, Droplet } from "lucide-react";

interface PatientDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device;
}

export const PatientDetailsModal = ({
  open,
  onOpenChange,
  device,
}: PatientDetailsModalProps) => {
  const [progressMode, setProgressMode] = useState<"time" | "volume">(
    device.progress?.mode || "time"
  );

  // Only require infusion details - patient and progress are optional
  if (!device.infusion) {
    return null;
  }

  const getProgressValue = () => {
    if (!device.progress) return 0;

    if (progressMode === "time") {
      const remaining = device.progress.timeRemainingMin;
      const total = device.infusion!.plannedTimeMin;
      return total > 0 ? ((total - remaining) / total) * 100 : 0;
    } else {
      const remaining = device.progress.volumeRemainingMl;
      const total = device.infusion!.plannedVolumeMl;
      return total > 0 ? ((total - remaining) / total) * 100 : 0;
    }
  };

  const getRemainingValue = () => {
    if (!device.progress) return "N/A";

    if (progressMode === "time") {
      return `${device.progress.timeRemainingMin} min`;
    } else {
      return `${device.progress.volumeRemainingMl} ml`;
    }
  };

  const handleToggleMode = () => {
    const newMode = progressMode === "time" ? "volume" : "time";
    console.log("🔄 Toggle Progress Mode", {
      deviceId: device.deviceId,
      from: progressMode,
      to: newMode,
      timestamp: new Date().toISOString(),
    });
    setProgressMode(newMode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-primary/5 via-background to-secondary/10 p-4 sm:p-6 rounded-2xl border-0">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-2xl">
            Patient & Infusion Details - {device.deviceId}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Patient Info */}
          <Card className="glass-dark">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <User className="h-5 w-5" />
                <h3>Patient Information</h3>
              </div>
              {device.patient ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-semibold">{device.patient.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Age</p>
                    <p className="font-semibold">{device.patient.age} years</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Weight</p>
                    <p className="font-semibold">{device.patient.weight} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Bed No.</p>
                    <p className="font-semibold">{device.patient.bedNo}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Drug Infused
                    </p>
                    <p className="font-semibold">
                      {device.patient.drugInfused}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Allergies</p>
                    <p className="font-semibold">{device.patient.allergies}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <p className="text-lg font-medium text-muted-foreground mb-2">
                      Patient Details Skipped
                    </p>
                    <p className="text-sm text-muted-foreground">
                      This infusion was started without patient information
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Infusion Details */}
          <Card className="glass-dark">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <Syringe className="h-5 w-5" />
                <h3>Infusion Details</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Flow Rate</p>
                  <p className="font-semibold">
                    {device.infusion.flowRateMlMin} ml/min
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Planned Time</p>
                  <p className="font-semibold">
                    {device.infusion.plannedTimeMin} min
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Planned Volume
                  </p>
                  <p className="font-semibold">
                    {device.infusion.plannedVolumeMl} ml
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bolus</p>
                  <p className="font-semibold">
                    {device.infusion.bolus.enabled
                      ? `Yes (${device.infusion.bolus.volumeMl} ml)`
                      : "No"}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Progress */}
          {device.progress ? (
            <Card className="glass-dark">
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-primary font-semibold">
                    {progressMode === "time" ? (
                      <Clock className="h-5 w-5" />
                    ) : (
                      <Droplet className="h-5 w-5" />
                    )}
                    <h3>
                      {progressMode === "time"
                        ? "Time Remaining"
                        : "Volume Remaining"}
                    </h3>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleMode}
                  >
                    Switch to {progressMode === "time" ? "Volume" : "Time"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-semibold">
                      {Math.round(getProgressValue())}%
                    </span>
                  </div>
                  <Progress value={getProgressValue()} className="h-3" />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining</span>
                    <span className="font-semibold text-primary">
                      {getRemainingValue()}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="glass-dark">
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-primary font-semibold">
                  <Clock className="h-5 w-5" />
                  <h3>Progress</h3>
                </div>
                <div className="text-center py-4">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <p className="text-lg font-medium text-muted-foreground mb-2">
                      Progress Data Unavailable
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Real-time progress tracking is not available for this
                      infusion
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
