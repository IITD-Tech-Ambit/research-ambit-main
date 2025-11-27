import { useState, useEffect, useCallback, useRef } from "react";
import socketService, {
  DeviceStreamData,
  SocketEventCallbacks,
} from "../lib/socketService";

interface DeviceProgress {
  timeRemainingMin: number;
  volumeRemainingMl: number;
  timestamp: string;
}

interface DeviceError {
  errorId: string;
  type: string;
  message: string;
  severity: "high" | "medium" | "low";
  timestamp: string;
  details?: Record<string, unknown>;
  resolved?: boolean;
}

interface DeviceNotification {
  id: string;
  type: "error" | "warning" | "info" | "success";
  priority: "critical" | "warning" | "info";
  title: string;
  message: string;
  timestamp: string;
  deviceId: string;
  data?: Record<string, unknown>;
  showModal?: boolean;
}

interface DeviceStatus {
  status: string;
  lastPing: string;
  timestamp: string;
}

interface InfusionConfirmation {
  confirmed: boolean;
  infusionId: string;
  confirmedAt: string;
  parameters?: {
    flowRateMlMin: number;
    plannedTimeMin: number;
    plannedVolumeMl: number;
  };
}

interface InfusionCompletion {
  completed: boolean;
  completedAt: string;
  summary?: {
    totalTimeMin: number;
    totalVolumeMl: number;
    plannedTimeMin: number;
    plannedVolumeMl: number;
    avgFlowRate: number;
    efficiency: number;
  };
  deviceStatus?: string;
}

export interface UseDeviceSocketOptions {
  autoConnect?: boolean;
  baseUrl?: string;
}

export interface DeviceSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  progress: DeviceProgress | null;
  deviceError: DeviceError | null;
  status: DeviceStatus | null;
  infusionConfirmation: InfusionConfirmation | null;
  infusionCompletion: InfusionCompletion | null;
  notifications: DeviceNotification[];
  activeNotification: DeviceNotification | null; // For modal display
}

export const useDeviceSocket = (
  deviceId?: string,
  options: UseDeviceSocketOptions = {}
) => {
  const [state, setState] = useState<DeviceSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    progress: null,
    deviceError: null,
    status: null,
    infusionConfirmation: null,
    infusionCompletion: null,
    notifications: [],
    activeNotification: null,
  });

  const { autoConnect = true, baseUrl } = options;
  const isSubscribed = useRef(false);
  const currentDeviceId = useRef(deviceId);

  // Update device ID ref when it changes
  useEffect(() => {
    currentDeviceId.current = deviceId;
  }, [deviceId]);

  // Connect to Socket.IO server (memoized to prevent unnecessary reconnections)
  const connect = useCallback(async () => {
    if (state.isConnected || state.isConnecting) return;

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      const callbacks: SocketEventCallbacks = {
        onConnect: () => {
          setState((prev) => ({
            ...prev,
            isConnected: true,
            isConnecting: false,
            error: null,
          }));
        },
        onDisconnect: () => {
          setState((prev) => ({
            ...prev,
            isConnected: false,
            isConnecting: false,
          }));
          isSubscribed.current = false;
        },
        onReconnect: () => {
          setState((prev) => ({
            ...prev,
            isConnected: true,
            isConnecting: false,
            error: null,
          }));
          // Re-subscribe to device if we were subscribed before
          if (currentDeviceId.current && isSubscribed.current) {
            socketService.subscribeToDevice(currentDeviceId.current);
          }
        },
        onProgress: (receivedDeviceId, progress) => {
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({ ...prev, progress }));
          }
        },
        onError: (receivedDeviceId, deviceError) => {
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({ ...prev, deviceError }));
          }
        },
        onStatus: (receivedDeviceId, status) => {
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({ ...prev, status }));
          }
        },
        onInfusionConfirmed: (receivedDeviceId, infusionConfirmation) => {
          console.log("🔔 Socket received infusion confirmation:", {
            receivedDeviceId,
            infusionConfirmation,
            targetDeviceId: currentDeviceId.current,
          });
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({ ...prev, infusionConfirmation }));
          }
        },
        onInfusionCompleted: (receivedDeviceId, infusionCompletion) => {
          console.log("🏁 Socket received infusion completion:", {
            receivedDeviceId,
            infusionCompletion,
            targetDeviceId: currentDeviceId.current,
          });
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({ ...prev, infusionCompletion }));
          }
        },
        onNotification: (receivedDeviceId, notification) => {
          console.log("🔔 Socket received notification:", {
            receivedDeviceId,
            notification,
            targetDeviceId: currentDeviceId.current,
          });
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({
              ...prev,
              notifications: [notification, ...prev.notifications].slice(0, 20), // Keep last 20 notifications
              activeNotification: notification.showModal
                ? notification
                : prev.activeNotification,
            }));
          }
        },
        onNotifications: (receivedDeviceId, notifications) => {
          console.log("📬 Socket received notifications:", {
            receivedDeviceId,
            notifications,
            targetDeviceId: currentDeviceId.current,
          });
          if (
            !currentDeviceId.current ||
            receivedDeviceId === currentDeviceId.current
          ) {
            setState((prev) => ({
              ...prev,
              notifications: notifications.slice(0, 20), // Keep last 20 notifications
            }));
          }
        },
      };

      await socketService.connect(callbacks);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect";
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
    }
  }, [state.isConnected, state.isConnecting]); // Removed deviceId from dependencies

  // Subscribe to device data
  const subscribeToDevice = useCallback((targetDeviceId: string) => {
    if (!socketService.getConnectionStatus()) {
      throw new Error("Socket not connected");
    }

    socketService.subscribeToDevice(targetDeviceId);
    isSubscribed.current = true;
  }, []);

  // Unsubscribe from device data
  const unsubscribeFromDevice = useCallback((targetDeviceId: string) => {
    if (socketService.getConnectionStatus()) {
      socketService.unsubscribeFromDevice(targetDeviceId);
    }
    isSubscribed.current = false;
  }, []);

  // Wait for device confirmation
  const waitForDeviceConfirmation = useCallback(
    async (targetDeviceId: string, timeout = 30000) => {
      if (!socketService.getConnectionStatus()) {
        throw new Error("Socket not connected");
      }

      return await socketService.waitForDeviceConfirmation(
        targetDeviceId,
        timeout
      );
    },
    []
  );

  // Disconnect from Socket.IO server
  const disconnect = useCallback(() => {
    socketService.disconnect();
    isSubscribed.current = false;
    setState({
      isConnected: false,
      isConnecting: false,
      error: null,
      progress: null,
      deviceError: null,
      status: null,
      infusionConfirmation: null,
      infusionCompletion: null,
      notifications: [],
      activeNotification: null,
    });
  }, []);

  // Auto-connect effect with better error handling (only if not already connected globally)
  useEffect(() => {
    if (
      autoConnect &&
      !state.isConnected &&
      !state.isConnecting &&
      !socketService.getConnectionStatus()
    ) {
      console.log("🔄 Auto-connecting to socket service...");
      connect().catch((err) => {
        console.error("Auto-connect failed:", err);
        // Don't automatically retry here, let the component handle retries
      });
    }
  }, [autoConnect, state.isConnected, state.isConnecting, connect]);

  // Auto-subscribe to device when connected
  useEffect(() => {
    if (deviceId && state.isConnected && !isSubscribed.current) {
      subscribeToDevice(deviceId);
    }
  }, [deviceId, state.isConnected, subscribeToDevice]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (currentDeviceId.current && isSubscribed.current) {
        if (socketService.getConnectionStatus()) {
          socketService.unsubscribeFromDevice(currentDeviceId.current);
        }
        isSubscribed.current = false;
      }
    };
  }, []); // Empty dependency array - only run on mount/unmount

  // Stable utility functions
  const clearProgress = useCallback(
    () => setState((prev) => ({ ...prev, progress: null })),
    []
  );
  const clearError = useCallback(
    () => setState((prev) => ({ ...prev, deviceError: null })),
    []
  );
  const clearInfusionConfirmation = useCallback(
    () => setState((prev) => ({ ...prev, infusionConfirmation: null })),
    []
  );
  const clearInfusionCompletion = useCallback(
    () => setState((prev) => ({ ...prev, infusionCompletion: null })),
    []
  );
  const clearActiveNotification = useCallback(
    () => setState((prev) => ({ ...prev, activeNotification: null })),
    []
  );
  const dismissNotification = useCallback(
    (notificationId: string) =>
      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.filter(
          (n) => n.id !== notificationId
        ),
        activeNotification:
          prev.activeNotification?.id === notificationId
            ? null
            : prev.activeNotification,
      })),
    []
  );

  return {
    // Connection state
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    connectionError: state.error,

    // Device data
    progress: state.progress,
    deviceError: state.deviceError,
    status: state.status,
    infusionConfirmation: state.infusionConfirmation,
    infusionCompletion: state.infusionCompletion,
    notifications: state.notifications,
    activeNotification: state.activeNotification,

    // Actions
    connect,
    disconnect,
    subscribeToDevice,
    unsubscribeFromDevice,
    waitForDeviceConfirmation,

    // Utils
    clearProgress,
    clearError,
    clearInfusionConfirmation,
    clearInfusionCompletion,
    clearActiveNotification,
    dismissNotification,
  };
};

export default useDeviceSocket;
