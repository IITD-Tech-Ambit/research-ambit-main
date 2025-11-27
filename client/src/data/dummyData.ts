export const DUMMY_ADMIN = {
  name: "Sudarshan Admin",
  email: "admin@hospital.example",
  lastLogin: "2025-09-28T10:24:00+05:30",
};

export const DUMMY_ATTENDEE = {
  name: "Nurse K. Mehta",
  email: "nurse.mehta@hospital.example",
  lastLogin: "2025-10-01T08:40:00+05:30",
};

export const DUMMY_DEVICE_DIRECTORY = [
  { deviceId: "PUMP_0001", location: "ICU Bay 3" },
  { deviceId: "PUMP_002", location: "Ward 5 - Bed 12" },
  { deviceId: "PUMP_003", location: "OT-2" },
  { deviceId: "PUMP_004", location: "ICU Bay 1" },
];

export type DeviceStatus =
  | "Healthy"
  | "Running"
  | "Issue"
  | "Degraded"
  | "Paused";

export interface Patient {
  name: string;
  age: number;
  weight: number;
  bedNo: string;
  drugInfused: string;
  allergies: string;
}

export interface Infusion {
  flowRateMlMin: number;
  plannedTimeMin: number;
  plannedVolumeMl: number;
  bolus: {
    enabled: boolean;
    volumeMl: number;
  };
}

export interface Device {
  deviceId: string;
  status: DeviceStatus;
  infusionsCompleted: number;
  lastOnline: string;
  patient?: Patient;
  infusion?: Infusion;
  progress?: {
    mode: "time" | "volume";
    timeRemainingMin: number;
    volumeRemainingMl: number;
  };
}

export const DUMMY_DEVICES: Device[] = [
  {
    deviceId: "PUMP_001",
    status: "Running",
    infusionsCompleted: 42,
    lastOnline: "2025-09-28T10:22:00+05:30",
    patient: {
      name: "Riya Sharma",
      age: 32,
      weight: 58,
      bedNo: "ICU-12",
      drugInfused: "Dopamine",
      allergies: "None",
    },
    infusion: {
      flowRateMlMin: 3.5,
      plannedTimeMin: 20,
      plannedVolumeMl: 70,
      bolus: { enabled: true, volumeMl: 5 },
    },
    progress: {
      mode: "time",
      timeRemainingMin: 12,
      volumeRemainingMl: 41,
    },
  },
  {
    deviceId: "PUMP_002",
    status: "Healthy",
    infusionsCompleted: 19,
    lastOnline: "2025-09-28T10:24:00+05:30",
  },
  {
    deviceId: "PUMP_003",
    status: "Issue",
    infusionsCompleted: 8,
    lastOnline: "2025-09-28T10:23:10+05:30",
  },
  {
    deviceId: "PUMP_004",
    status: "Degraded",
    infusionsCompleted: 65,
    lastOnline: "2025-09-28T08:11:05+05:30",
  },
];

export interface DeviceLog {
  ts: string;
  deviceId: string;
  action: string;
  actor: string;
  note: string;
}

export const DUMMY_LOGS: DeviceLog[] = [
  {
    ts: "2025-09-28T09:00:00+05:30",
    deviceId: "PUMP_001",
    action: "start",
    actor: "Dr. A. Verma",
    note: "Start Infusion wizard",
  },
  {
    ts: "2025-09-28T09:05:00+05:30",
    deviceId: "PUMP_001",
    action: "pause",
    actor: "Dr. A. Verma",
    note: "Clinical assessment",
  },
  {
    ts: "2025-09-28T09:06:00+05:30",
    deviceId: "PUMP_001",
    action: "resume",
    actor: "Dr. A. Verma",
    note: "Resumed per protocol",
  },
  {
    ts: "2025-09-28T09:15:00+05:30",
    deviceId: "PUMP_002",
    action: "schedule",
    actor: "Dr. A. Verma",
    note: "Scheduled for 12:30",
  },
];

export interface Notification {
  id: string;
  ts: string;
  text: string;
}

export interface DeviceState {
  deviceId: string;
  status: DeviceStatus;
  location: string;
  patient?: Patient;
  infusion?: Infusion;
  progress?: {
    mode: "time" | "volume";
    timeRemainingMin: number;
    volumeRemainingMl: number;
  };
  notifications: Notification[];
  logs: DeviceLog[];
}

export const DUMMY_DEVICE_STATE: Record<string, DeviceState> = {
  PUMP_0001: {
    deviceId: "PUMP_0001",
    status: "Running",
    location: "ICU Bay 3",
    patient: {
      name: "Riya Sharma",
      age: 32,
      weight: 58,
      bedNo: "ICU-12",
      drugInfused: "Dopamine",
      allergies: "None",
    },
    infusion: {
      flowRateMlMin: 3.5,
      plannedTimeMin: 20,
      plannedVolumeMl: 20,
      bolus: { enabled: true, volumeMl: 5 },
    },
    progress: {
      mode: "time",
      timeRemainingMin: 12,
      volumeRemainingMl: 13,
    },
    notifications: [
      {
        id: "n1",
        ts: "2025-10-01T08:41:00+05:30",
        text: "Calibration check due tomorrow.",
      },
      {
        id: "n2",
        ts: "2025-10-01T09:10:00+05:30",
        text: "IV line inspection reminder.",
      },
    ],
    logs: [
      {
        ts: "2025-10-01T08:45:00+05:30",
        deviceId: "PUMP_001",
        action: "start",
        actor: "Nurse K. Mehta",
        note: "Started per Dr. order",
      },
      {
        ts: "2025-10-01T09:00:00+05:30",
        deviceId: "PUMP_001",
        action: "pause",
        actor: "Nurse K. Mehta",
        note: "Vitals check",
      },
      {
        ts: "2025-10-01T09:05:00+05:30",
        deviceId: "PUMP_001",
        action: "resume",
        actor: "Nurse K. Mehta",
        note: "Resumed infusion",
      },
    ],
  },
  PUMP_002: {
    deviceId: "PUMP_002",
    status: "Healthy",
    location: "Ward 5 - Bed 12",
    notifications: [],
    logs: [],
  },
  PUMP_003: {
    deviceId: "PUMP_003",
    status: "Issue",
    location: "OT-2",
    notifications: [
      {
        id: "n3",
        ts: "2025-10-01T07:30:00+05:30",
        text: "Sensor error detected - maintenance required.",
      },
    ],
    logs: [
      {
        ts: "2025-10-01T07:30:00+05:30",
        deviceId: "PUMP_003",
        action: "stop",
        actor: "Nurse K. Mehta",
        note: "Sensor error",
      },
    ],
  },
  PUMP_004: {
    deviceId: "PUMP_004",
    status: "Degraded",
    location: "ICU Bay 1",
    notifications: [
      {
        id: "n4",
        ts: "2025-09-30T22:15:00+05:30",
        text: "Device offline for extended period.",
      },
    ],
    logs: [],
  },
};
