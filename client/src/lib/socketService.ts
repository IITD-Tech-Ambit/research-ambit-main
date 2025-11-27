import { io, Socket } from "socket.io-client";

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

export interface DeviceStreamData {
  progress?: DeviceProgress;
  error?: DeviceError;
  status?: DeviceStatus;
  infusionConfirmation?: InfusionConfirmation;
  infusionCompletion?: InfusionCompletion;
  notifications?: DeviceNotification[];
}

export interface SocketEventCallbacks {
  onProgress?: (deviceId: string, data: DeviceProgress) => void;
  onError?: (deviceId: string, data: DeviceError) => void;
  onStatus?: (deviceId: string, data: DeviceStatus) => void;
  onInfusionConfirmed?: (deviceId: string, data: InfusionConfirmation) => void;
  onInfusionCompleted?: (deviceId: string, data: InfusionCompletion) => void;
  onNotification?: (deviceId: string, data: DeviceNotification) => void;
  onNotifications?: (deviceId: string, data: DeviceNotification[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

class SocketService {
  private socket: Socket | null = null;
  private isConnected = false;
  private isConnecting = false; // Track connection state
  private baseUrl: string;
  private callbacks: SocketEventCallbacks = {};

  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl;
  }

  connect(callbacks: SocketEventCallbacks = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        // Update callbacks for existing connection
        this.callbacks = { ...this.callbacks, ...callbacks };
        console.log("🔌 Socket already connected, updating callbacks");
        resolve();
        return;
      }

      // Prevent multiple connection attempts
      if (this.isConnecting) {
        console.log("🔌 Socket connection already in progress, waiting...");
        // Wait for current connection attempt to complete
        const checkConnection = () => {
          if (this.socket?.connected) {
            this.callbacks = { ...this.callbacks, ...callbacks };
            resolve();
          } else if (!this.isConnecting) {
            reject(new Error("Connection attempt failed"));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        setTimeout(checkConnection, 100);
        return;
      }

      console.log("� Attempting Socket.IO connection to:", this.baseUrl);
      this.isConnecting = true;
      this.callbacks = callbacks;

      // Disconnect any existing socket first
      if (this.socket) {
        this.socket.disconnect();
        this.socket.removeAllListeners();
      }

      this.socket = io(this.baseUrl, {
        transports: ["websocket", "polling"],
        timeout: 20000,
        forceNew: true, // Force new connection to prevent issues
        reconnection: false, // Disable auto-reconnection to prevent spam
        reconnectionAttempts: 0,
        reconnectionDelay: 5000,
      });

      // Add a connection timeout
      const connectionTimeout = setTimeout(() => {
        console.error("⏰ Socket connection timeout after 20 seconds");
        if (this.socket && !this.socket.connected) {
          this.socket.disconnect();
          reject(
            new Error("Connection timeout - Backend server may not be running")
          );
        }
      }, 20000);

      this.socket.on("connect", () => {
        console.log("🔌 Connected to Socket.IO server");
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.isConnecting = false;
        this.callbacks.onConnect?.();
        resolve();
      });

      this.socket.on("disconnect", (reason) => {
        console.log("🔌 Disconnected from Socket.IO server:", reason);
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.isConnecting = false;
        this.callbacks.onDisconnect?.();
      });

      this.socket.on("reconnect", () => {
        console.log("🔌 Reconnected to Socket.IO server");
        this.isConnected = true;
        this.callbacks.onReconnect?.();
      });

      this.socket.on("connect_error", (error) => {
        console.error("🔌 Socket connection error:", error);
        console.error("🔍 Error message:", error.message);
        clearTimeout(connectionTimeout);
        this.isConnecting = false;

        // Provide more helpful error messages
        let errorMessage = error.message;
        if (
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ERR_CONNECTION_REFUSED")
        ) {
          errorMessage = "Backend server is not running on localhost:3000";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Connection timeout - server may be slow to respond";
        }

        reject(new Error(errorMessage));
      });

      // Device event listeners
      this.socket.on(
        "device:progress",
        (data: { deviceId: string; progress: DeviceProgress }) => {
          console.log("📈 Received progress data:", data);
          this.callbacks.onProgress?.(data.deviceId, data.progress);
        }
      );

      this.socket.on(
        "device:error",
        (data: { deviceId: string; error: DeviceError }) => {
          console.log("🚨 Received error data:", data);
          this.callbacks.onError?.(data.deviceId, data.error);
        }
      );

      this.socket.on(
        "device:status",
        (data: { deviceId: string; status: DeviceStatus }) => {
          console.log("📊 Received status data:", data);
          this.callbacks.onStatus?.(data.deviceId, data.status);
        }
      );

      this.socket.on(
        "device:infusion:confirmed",
        (data: { deviceId: string; confirmation: InfusionConfirmation }) => {
          console.log("💉 Received infusion confirmation:", data);
          console.log("🔍 Confirmation data details:", {
            deviceId: data.deviceId,
            confirmed: data.confirmation?.confirmed,
            infusionId: data.confirmation?.infusionId,
            confirmedAt: data.confirmation?.confirmedAt,
            hasCallback: !!this.callbacks.onInfusionConfirmed,
            callbackFunction:
              this.callbacks.onInfusionConfirmed?.name || "anonymous",
          });

          // Ensure we have valid confirmation data before calling callback
          if (
            data.confirmation &&
            data.deviceId &&
            this.callbacks.onInfusionConfirmed
          ) {
            this.callbacks.onInfusionConfirmed(
              data.deviceId,
              data.confirmation
            );
          } else {
            console.warn("⚠️ Invalid confirmation data or missing callback:", {
              hasConfirmation: !!data.confirmation,
              hasDeviceId: !!data.deviceId,
              hasCallback: !!this.callbacks.onInfusionConfirmed,
            });
          }
        }
      );

      this.socket.on(
        "device:infusion:completed",
        (data: { deviceId: string; completion: InfusionCompletion }) => {
          console.log("🏁 Received infusion completion:", data);
          console.log("🔍 Completion data details:", {
            deviceId: data.deviceId,
            completed: data.completion?.completed,
            completedAt: data.completion?.completedAt,
            summary: data.completion?.summary,
            hasCallback: !!this.callbacks.onInfusionCompleted,
            callbackFunction:
              this.callbacks.onInfusionCompleted?.name || "anonymous",
          });

          // Ensure we have valid completion data before calling callback
          if (
            data.completion &&
            data.deviceId &&
            this.callbacks.onInfusionCompleted
          ) {
            this.callbacks.onInfusionCompleted(data.deviceId, data.completion);
          } else {
            console.warn("⚠️ Invalid completion data or missing callback:", {
              hasCompletion: !!data.completion,
              hasDeviceId: !!data.deviceId,
              hasCallback: !!this.callbacks.onInfusionCompleted,
            });
          }
        }
      );

      this.socket.on(
        "device:notification",
        (data: { deviceId: string; notification: DeviceNotification }) => {
          console.log("🔔 Received device notification:", data);

          if (
            data.notification &&
            data.deviceId &&
            this.callbacks.onNotification
          ) {
            this.callbacks.onNotification(data.deviceId, data.notification);
          }
        }
      );

      this.socket.on(
        "device:notifications",
        (data: { deviceId: string; notifications: DeviceNotification[] }) => {
          console.log("📬 Received device notifications:", data);

          if (
            data.notifications &&
            data.deviceId &&
            this.callbacks.onNotifications
          ) {
            this.callbacks.onNotifications(data.deviceId, data.notifications);
          }
        }
      );
    });
  }

  subscribeToDevice(deviceId: string): void {
    if (!this.socket?.connected) {
      throw new Error("Socket not connected");
    }

    console.log(`📡 Subscribing to device: ${deviceId}`);
    this.socket.emit("subscribe:device", { deviceId });

    // Add subscription confirmation listeners with timeout
    const confirmationTimeout = setTimeout(() => {
      console.warn(
        `⚠️ Subscription confirmation timeout for device ${deviceId}`
      );
    }, 5000);

    this.socket.once("stream:subscribed", (data) => {
      clearTimeout(confirmationTimeout);
      console.log(`✅ Successfully subscribed to device: ${data.deviceId}`);
    });

    this.socket.once("error", (error) => {
      clearTimeout(confirmationTimeout);
      console.error(`❌ Subscription error for device ${deviceId}:`, error);
    });
  }

  unsubscribeFromDevice(deviceId: string): void {
    if (!this.socket?.connected) {
      console.warn("Socket not connected, cannot unsubscribe");
      return;
    }

    console.log(`📡 Unsubscribing from device: ${deviceId}`);
    this.socket.emit("unsubscribe:device", { deviceId });
  }

  // Wait for device confirmation after starting infusion
  waitForDeviceConfirmation(
    deviceId: string,
    timeout = 30000
  ): Promise<InfusionConfirmation> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("Socket not connected"));
        return;
      }

      const timeoutId = setTimeout(() => {
        this.socket?.off("device:infusion:confirmed", confirmationHandler);
        reject(new Error("Device confirmation timeout"));
      }, timeout);

      const confirmationHandler = (data: {
        deviceId: string;
        confirmation: InfusionConfirmation;
      }) => {
        if (data.deviceId === deviceId) {
          clearTimeout(timeoutId);
          this.socket?.off("device:infusion:confirmed", confirmationHandler);
          resolve(data.confirmation);
        }
      };

      this.socket.on("device:infusion:confirmed", confirmationHandler);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket.removeAllListeners();
      this.socket = null;
      this.isConnected = false;
      this.isConnecting = false;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Update callbacks
  updateCallbacks(callbacks: SocketEventCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }
}

// Export singleton instance
export const socketService = new SocketService();
export default socketService;
