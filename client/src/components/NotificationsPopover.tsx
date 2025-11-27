import { useState, useEffect } from "react";
import { Bell, X, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Notification } from "@/data/dummyData";
import audioService from "@/services/audioService";

interface NotificationsPopoverProps {
  notifications: Notification[];
  onDelete: (id: string) => void;
  deviceId: string;
}

export const NotificationsPopover = ({
  notifications,
  onDelete,
  deviceId,
}: NotificationsPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(audioService.getEnabled());

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640); // sm breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleDelete = (id: string) => {
    console.log("🗑️ Delete Notification", {
      type: "notification_delete",
      id,
      deviceId,
      at: new Date().toISOString(),
    });
    onDelete(id);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    audioService.setEnabled(enabled);
    console.log(`🔊 Sound notifications ${enabled ? "enabled" : "disabled"}`);

    // Play test sound when enabling
    if (enabled) {
      audioService.testSound();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {notifications.length > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center">
              {notifications.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={`glass ${isMobile ? "w-[75vw] max-w-sm" : "w-80"}`}
        align={isMobile ? "center" : "end"}
        side={isMobile ? "bottom" : "bottom"}
        sideOffset={8}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Notifications</h4>
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              ) : (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              )}
              <Switch
                checked={soundEnabled}
                onCheckedChange={handleSoundToggle}
                className="scale-90"
              />
            </div>
          </div>

          <Separator />

          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No notifications
            </p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className="bg-muted/50 p-3 rounded-lg flex items-start gap-2"
                >
                  <div className="flex-1 space-y-1">
                    <p className="text-sm">{notif.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(notif.ts).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleDelete(notif.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
