import { DeviceStatus } from "@/data/dummyData";
import { cn } from "@/lib/utils";

interface StatusChipProps {
  status: DeviceStatus;
  showPulse?: boolean;
}

export const StatusChip = ({ status, showPulse = false }: StatusChipProps) => {
  const getStatusClass = () => {
    switch (status) {
      case "Healthy":
        return "status-healthy";
      case "Running":
        return "status-running";
      case "Paused":
        return "status-paused";
      case "Issue":
        return "status-issue";
      case "Degraded":
        return "status-degraded";
      default:
        return "";
    }
  };

  return (
    <span className={cn("status-chip", getStatusClass())}>
      {showPulse && status === "Running" && (
        <span className="relative flex h-2 w-2">
          <span className="animate-pulse-glow absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
        </span>
      )}
      {status}
    </span>
  );
};
