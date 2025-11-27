import api from "./api";

export interface DeviceDetails {
  _id: string;
  deviceId: string;
  location: string;
  status: "healthy" | "issue" | "running" | "paused" | "stopped" | "degraded";
  activeInfusion?: InfusionDetails | string | null; // Can be populated or just ID
  notifications: unknown[];
  logs: unknown[];
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface InfusionDetails {
  _id: string;
  device: string;
  patient?: {
    name: string;
    age: number;
    weight: number;
    bedNo: string;
    drugInfused: string;
    allergies: string;
  };
  patientDetailSkipped?: boolean;
  infusion_detail: {
    flowRateMlMin: number;
    plannedTimeMin: number;
    plannedVolumeMl: number;
    bolus: {
      enabled: boolean;
      volumeMl: number;
    };
  };
  status: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceApiResponse {
  success: boolean;
  message: string;
  data: {
    device: DeviceDetails;
  };
  timestamp: string;
}

export interface InfusionApiResponse {
  success: boolean;
  message: string;
  data: InfusionDetails;
  timestamp: string;
}

export const deviceApi = {
  // Get device details by ID
  getDeviceDetails: async (deviceId: string): Promise<DeviceDetails> => {
    const response = await api.get<DeviceApiResponse>(`/device/${deviceId}`);
    return response.data.data.device;
  },

  // Start infusion
  startInfusion: async (
    deviceId: string,
    params: {
      flowRateMlMin: number;
      plannedTimeMin: number;
      plannedVolumeMl: number;
      bolus?: {
        enabled: boolean;
        volumeMl: number;
      };
      patient?: {
        name: string;
        age: number;
        weight: number;
        bedNo: string;
        drugInfused: string;
        allergies: string;
      };
    }
  ) => {
    const response = await api.post(`/device/start/${deviceId}`, params);
    return response.data;
  },

  // Stop infusion
  stopInfusion: async (
    deviceId: string,
    params?: {
      reason?: string;
      emergency?: boolean;
    }
  ) => {
    const response = await api.post(`/device/stop/${deviceId}`, params || {});
    return response.data;
  },

  // Pause infusion
  pauseInfusion: async (
    deviceId: string,
    params?: {
      reason?: string;
    }
  ) => {
    const response = await api.post(`/device/pause/${deviceId}`, params || {});
    return response.data;
  },

  // Resume infusion
  resumeInfusion: async (deviceId: string) => {
    const response = await api.post(`/device/resume/${deviceId}`);
    return response.data;
  },

  // Get infusion details
  getInfusionDetails: async (
    deviceId: string,
    infusionId: string
  ): Promise<InfusionDetails> => {
    const response = await api.post<InfusionApiResponse>(
      `/device/infusion/${deviceId}`,
      {
        infusionId,
      }
    );
    return response.data.data;
  },
};
