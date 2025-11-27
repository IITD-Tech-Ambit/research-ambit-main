// Device Stream Service - Handles persistent device connections and recovery
class DeviceStreamService {
  constructor() {
    this.socket = null;
    this.currentDeviceId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 1000;
    this.listeners = new Map();
    this.isConnected = false;
    this.baseUrl = "http://localhost:3000"; // Configure based on environment
  }

  // Initialize connection for a specific device
  async connectToDevice(deviceId, options = {}) {
    this.currentDeviceId = deviceId;

    try {
      // First, get current device status to check if there's an active infusion
      const currentStatus = await this.getCurrentDeviceStatus(deviceId);

      // Connect to socket if not already connected
      if (!this.socket || !this.isConnected) {
        await this.connectSocket();
      }

      // Subscribe to device-specific events
      this.subscribeToDeviceEvents(deviceId);

      // If there's an active infusion, emit the recovery data
      if (currentStatus.hasActiveInfusion && options.onInfusionRecovered) {
        options.onInfusionRecovered(currentStatus);
      }

      // Store device in localStorage for page reload recovery
      localStorage.setItem("currentDeviceId", deviceId);

      console.log(`📱 Connected to device ${deviceId} stream`);
      return currentStatus;
    } catch (error) {
      console.error(`❌ Failed to connect to device ${deviceId}:`, error);
      throw error;
    }
  }

  // Get current device status and infusion info
  async getCurrentDeviceStatus(deviceId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/device/status/${deviceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            // Add authorization headers if needed
            // 'Authorization': `Bearer ${token}`
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get device status: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error(
        `❌ Failed to get current device status for ${deviceId}:`,
        error
      );
      throw error;
    }
  }

  // Get device stream data (historical data)
  async getDeviceStreamData(deviceId, type = "progress", count = 50) {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/device/stream/${deviceId}?type=${type}&count=${count}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            // Add authorization headers if needed
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get stream data: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error(`❌ Failed to get stream data for ${deviceId}:`, error);
      throw error;
    }
  }

  // Connect to Socket.IO
  async connectSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Note: This assumes socket.io-client is available
        // You'll need to install it: npm install socket.io-client
        if (typeof io === "undefined") {
          console.warn(
            "⚠️ Socket.IO client not available. Install socket.io-client or include the script."
          );
          resolve(); // Continue without socket for now
          return;
        }

        this.socket = io(this.baseUrl, {
          transports: ["websocket"],
        });

        this.socket.on("connect", () => {
          console.log("🔌 Connected to socket server");
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        });

        this.socket.on("disconnect", () => {
          console.log("🔌 Disconnected from socket server");
          this.isConnected = false;
          this.handleReconnection();
        });

        this.socket.on("error", (error) => {
          console.error("🔌 Socket error:", error);
          reject(error);
        });

        // Device-specific event listeners
        this.socket.on("device:progress:update", (data) => {
          this.emitToListeners("progress", data);
        });

        this.socket.on("device:status:update", (data) => {
          this.emitToListeners("status", data);
        });

        this.socket.on("device:infusion:confirmed", (data) => {
          this.emitToListeners("infusion", data);
        });

        this.socket.on("device:error", (data) => {
          this.emitToListeners("error", data);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Subscribe to device-specific events
  subscribeToDeviceEvents(deviceId) {
    if (!this.socket || !this.isConnected) {
      console.warn("⚠️ Socket not connected, cannot subscribe to events");
      return;
    }

    console.log(`📡 Subscribing to events for device: ${deviceId}`);

    this.socket.emit("subscribe:device:progress", deviceId);
    this.socket.emit("subscribe:device:status", deviceId);
    this.socket.emit("subscribe:device:infusion", deviceId);
    this.socket.emit("subscribe:device:errors", deviceId);
  }

  // Handle reconnection logic
  handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("❌ Max reconnection attempts reached");
      this.emitToListeners("connectionLost", {
        deviceId: this.currentDeviceId,
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * this.reconnectAttempts;

    console.log(
      `🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      if (this.currentDeviceId) {
        this.connectToDevice(this.currentDeviceId);
      }
    }, delay);
  }

  // Add event listener
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  // Remove event listener
  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  // Emit events to listeners
  emitToListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // Recover device connection on page load
  async recoverDeviceConnection(options = {}) {
    const savedDeviceId = localStorage.getItem("currentDeviceId");

    if (savedDeviceId) {
      console.log(`🔄 Recovering connection to device: ${savedDeviceId}`);
      try {
        return await this.connectToDevice(savedDeviceId, options);
      } catch (error) {
        console.error("❌ Failed to recover device connection:", error);
        localStorage.removeItem("currentDeviceId");
        throw error;
      }
    } else {
      console.log("📱 No saved device found for recovery");
      return null;
    }
  }

  // Disconnect from current device
  disconnect() {
    if (this.socket) {
      if (this.currentDeviceId) {
        console.log(`📱 Disconnecting from device: ${this.currentDeviceId}`);
        // Unsubscribe from device events
        this.socket.emit("unsubscribe:device:progress", this.currentDeviceId);
        this.socket.emit("unsubscribe:device:status", this.currentDeviceId);
        this.socket.emit("unsubscribe:device:infusion", this.currentDeviceId);
        this.socket.emit("unsubscribe:device:errors", this.currentDeviceId);
      }

      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnected = false;
    this.currentDeviceId = null;
    this.listeners.clear();
    localStorage.removeItem("currentDeviceId");
  }

  // Get current connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      currentDeviceId: this.currentDeviceId,
      hasSocket: !!this.socket,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // Set base URL for API calls
  setBaseUrl(url) {
    this.baseUrl = url;
  }
}

// Create singleton instance
const deviceStreamService = new DeviceStreamService();

// Auto-recover on page load
window.addEventListener("load", async () => {
  try {
    await deviceStreamService.recoverDeviceConnection({
      onInfusionRecovered: (status) => {
        console.log("🔄 Recovered infusion data:", status);
        // Emit custom event for components to handle recovery
        window.dispatchEvent(
          new CustomEvent("deviceInfusionRecovered", {
            detail: status,
          })
        );
      },
    });
  } catch (error) {
    console.error("❌ Failed to auto-recover device connection:", error);
  }
});

// Export for use in modules or global access
if (typeof module !== "undefined" && module.exports) {
  module.exports = deviceStreamService;
} else {
  window.deviceStreamService = deviceStreamService;
}
