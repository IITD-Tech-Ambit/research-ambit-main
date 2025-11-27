import { useState, useEffect, useCallback, useRef } from "react";

interface InfusionParameters {
  flowRateMlMin?: number;
  plannedTimeMin?: number;
  plannedVolumeMl?: number;
  bolusEnabled?: boolean;
  bolusVolumeMl?: number;
}

interface ProgressData {
  timeRemainingMin: number;
  volumeRemainingMl: number;
  timestamp: string;
  infusionId: string;
  progressPercent?: {
    time: number;
    volume: number;
  };
}

interface DeviceStreamService {
  setBaseUrl: (url: string) => void;
  connectToDevice: (
    deviceId: string,
    options?: { onInfusionRecovered?: (status: DeviceStatus) => void }
  ) => Promise<DeviceStatus>;
  getCurrentDeviceStatus: (deviceId: string) => Promise<DeviceStatus>;
  getDeviceStreamData: (
    deviceId: string,
    type: string,
    count: number
  ) => Promise<ProgressData[]>;
  disconnect: () => void;
  addEventListener: (event: string, callback: (data: unknown) => void) => void;
  removeEventListener: (
    event: string,
    callback: (data: unknown) => void
  ) => void;
}

declare global {
  interface Window {
    deviceStreamService: DeviceStreamService;
  }
}

interface DeviceStatus {
  device: {
    deviceId: string;
    status: string;
    location: string;
  };
  currentInfusion: {
    infusionId: string;
    status: string;
    startedAt: string;
    deviceId: string;
    parameters: InfusionParameters;
  } | null;
  latestProgress: {
    timeRemainingMin: number;
    volumeRemainingMl: number;
    timestamp: string;
    infusionId: string;
  } | null;
  latestStatus: {
    status: string;
    lastPing: string;
    timestamp: string;
  } | null;
  infusionDetails: {
    _id: string;
    device: string;
    patient?: Record<string, unknown>;
    infusion_detail: InfusionParameters;
    createdAt: string;
  } | null;
  recentProgress: ProgressData[];
  hasActiveInfusion: boolean;
}

interface ProgressUpdate {
  deviceId: string;
  progress: {
    timeRemainingMin: number;
    volumeRemainingMl: number;
    lastUpdated: string;
  };
  timestamp: string;
}

interface StatusUpdate {
  deviceId: string;
  status: string;
  lastPing: string;
  timestamp: string;
}

interface UseDeviceStreamOptions {
  autoConnect?: boolean;
  autoRecover?: boolean;
  baseUrl?: string;
}

export const useDeviceStream = (
  deviceId?: string,
  options: UseDeviceStreamOptions = {}
) => {
  const [connectionStatus, setConnectionStatus] = useState<{
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
  }>({
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [latestProgress, setLatestProgress] = useState<ProgressUpdate | null>(
    null
  );
  const [latestStatusUpdate, setLatestStatusUpdate] =
    useState<StatusUpdate | null>(null);
  const [infusionRecovered, setInfusionRecovered] = useState(false);

  const serviceRef = useRef<DeviceStreamService | null>(null);
  const { autoConnect = true, autoRecover = true, baseUrl } = options;

  // Initialize device stream service
  useEffect(() => {
    // Import service dynamically or access from window
    if (typeof window !== "undefined" && window.deviceStreamService) {
      serviceRef.current = window.deviceStreamService;

      if (baseUrl) {
        serviceRef.current.setBaseUrl(baseUrl);
      }
    } else {
      console.warn("DeviceStreamService not available");
      return;
    }

    // Set up event listeners
    const handleProgress = (data: ProgressUpdate) => {
      if (!deviceId || data.deviceId === deviceId) {
        setLatestProgress(data);
      }
    };

    const handleStatus = (data: StatusUpdate) => {
      if (!deviceId || data.deviceId === deviceId) {
        setLatestStatusUpdate(data);
      }
    };

    const handleConnectionLost = () => {
      setConnectionStatus((prev) => ({
        ...prev,
        isConnected: false,
        error: "Connection lost to device",
      }));
    };

    const handleInfusionRecovered = (event: CustomEvent) => {
      const recoveredStatus = event.detail;
      if (!deviceId || recoveredStatus.device.deviceId === deviceId) {
        setDeviceStatus(recoveredStatus);
        setInfusionRecovered(true);
        setConnectionStatus((prev) => ({
          ...prev,
          isConnected: true,
          error: null,
        }));
      }
    };

    // Add event listeners
    serviceRef.current.addEventListener("progress", handleProgress);
    serviceRef.current.addEventListener("status", handleStatus);
    serviceRef.current.addEventListener("connectionLost", handleConnectionLost);

    // Listen for recovery events
    window.addEventListener("deviceInfusionRecovered", handleInfusionRecovered);

    return () => {
      // Cleanup listeners
      if (serviceRef.current) {
        serviceRef.current.removeEventListener("progress", handleProgress);
        serviceRef.current.removeEventListener("status", handleStatus);
        serviceRef.current.removeEventListener(
          "connectionLost",
          handleConnectionLost
        );
      }
      window.removeEventListener(
        "deviceInfusionRecovered",
        handleInfusionRecovered
      );
    };
  }, [deviceId, baseUrl]);

  // Connect to device
  const connectToDevice = useCallback(async (targetDeviceId: string) => {
    if (!serviceRef.current) {
      throw new Error("DeviceStreamService not available");
    }

    setConnectionStatus((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }));

    try {
      const status = await serviceRef.current.connectToDevice(targetDeviceId, {
        onInfusionRecovered: (recoveredStatus: DeviceStatus) => {
          setDeviceStatus(recoveredStatus);
          setInfusionRecovered(true);
        },
      });

      setDeviceStatus(status);
      setConnectionStatus({
        isConnected: true,
        isConnecting: false,
        error: null,
      });

      return status;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect to device";
      setConnectionStatus({
        isConnected: false,
        isConnecting: false,
        error: errorMessage,
      });
      throw error;
    }
  }, []);

  // Disconnect from device
  const disconnect = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
    }
    setConnectionStatus({
      isConnected: false,
      isConnecting: false,
      error: null,
    });
    setDeviceStatus(null);
    setLatestProgress(null);
    setLatestStatusUpdate(null);
    setInfusionRecovered(false);
  }, []);

  // Get device stream data
  const getStreamData = useCallback(
    async (type: string = "progress", count: number = 50) => {
      if (!serviceRef.current || !deviceId) {
        throw new Error("Device not connected");
      }

      return await serviceRef.current.getDeviceStreamData(
        deviceId,
        type,
        count
      );
    },
    [deviceId]
  );

  // Refresh device status
  const refreshStatus = useCallback(async () => {
    if (!serviceRef.current || !deviceId) {
      throw new Error("Device not connected");
    }

    try {
      const status = await serviceRef.current.getCurrentDeviceStatus(deviceId);
      setDeviceStatus(status);
      return status;
    } catch (error) {
      console.error("Failed to refresh device status:", error);
      throw error;
    }
  }, [deviceId]);

  // Auto-connect effect
  useEffect(() => {
    if (
      autoConnect &&
      deviceId &&
      !connectionStatus.isConnected &&
      !connectionStatus.isConnecting
    ) {
      connectToDevice(deviceId).catch((error) => {
        console.error("Auto-connect failed:", error);
      });
    }
  }, [
    autoConnect,
    deviceId,
    connectionStatus.isConnected,
    connectionStatus.isConnecting,
    connectToDevice,
  ]);

  return {
    // Connection state
    connectionStatus,
    isConnected: connectionStatus.isConnected,
    isConnecting: connectionStatus.isConnecting,
    connectionError: connectionStatus.error,

    // Device data
    deviceStatus,
    latestProgress,
    latestStatusUpdate,
    infusionRecovered,

    // Actions
    connectToDevice,
    disconnect,
    getStreamData,
    refreshStatus,

    // Computed values
    hasActiveInfusion: deviceStatus?.hasActiveInfusion || false,
    currentInfusionId: deviceStatus?.currentInfusion?.infusionId || null,
    deviceId: deviceStatus?.device?.deviceId || deviceId,
  };
};

export default useDeviceStream;
