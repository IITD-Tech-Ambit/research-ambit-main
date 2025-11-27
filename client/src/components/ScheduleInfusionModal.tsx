import { useState } from "react";
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
import { Calendar } from "lucide-react";

interface ScheduleInfusionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
}

export const ScheduleInfusionModal = ({
  open,
  onOpenChange,
  deviceId,
}: ScheduleInfusionModalProps) => {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const handleSchedule = () => {
    console.log("📅 Schedule Infusion", {
      deviceId,
      scheduledDate: date,
      scheduledTime: time,
      timestamp: new Date().toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass w-[95vw] max-w-md bg-gradient-to-br from-primary/5 via-background to-secondary/10 p-4 sm:p-6 rounded-2xl border-0">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl">Schedule Infusion</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Schedule an infusion for device{" "}
            <span className="font-mono font-semibold">{deviceId}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-date">Date</Label>
            <Input
              id="schedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-time">Time</Label>
            <Input
              id="schedule-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-12"
            />
          </div>
          <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground">
            This is a placeholder for scheduling functionality. In production,
            this would integrate with your scheduling system.
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={!date || !time}
            className="flex-1"
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
