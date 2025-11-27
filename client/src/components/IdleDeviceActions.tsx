import { useState } from "react";
import { Device } from "@/data/dummyData";
import { Button } from "@/components/ui/button";
import { Play, Calendar } from "lucide-react";
import { StartInfusionWizard } from "./StartInfusionWizard";
import { ScheduleInfusionModal } from "./ScheduleInfusionModal";

interface IdleDeviceActionsProps {
  device: Device;
  onUpdateDevice: (deviceId: string, updates: Partial<Device>) => void;
}

export const IdleDeviceActions = ({
  device,
  onUpdateDevice,
}: IdleDeviceActionsProps) => {
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => setStartModalOpen(true)}
          variant="default"
          className="flex-1 min-w-[160px] h-12"
        >
          <Play className="mr-2 h-4 w-4" />
          Start Infusion
        </Button>
        <Button
          onClick={() => setScheduleModalOpen(true)}
          variant="secondary"
          className="flex-1 min-w-[160px] h-12"
          disabled
        >
          <Calendar className="mr-2 h-4 w-4" />
          Schedule Infusion
        </Button>
      </div>

      <StartInfusionWizard
        open={startModalOpen}
        onOpenChange={setStartModalOpen}
        device={device}
        onUpdateDevice={onUpdateDevice}
      />

      <ScheduleInfusionModal
        open={scheduleModalOpen}
        onOpenChange={setScheduleModalOpen}
        deviceId={device.deviceId}
      />
    </>
  );
};
