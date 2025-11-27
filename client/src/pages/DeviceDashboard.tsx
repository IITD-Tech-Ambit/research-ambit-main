import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { NotificationsPopover } from "@/components/NotificationsPopover";
import { RunningDeviceActions } from "@/components/RunningDeviceActions";
import { StartInfusionWizard } from "@/components/StartInfusionWizard";
import { ScheduleInfusionModal } from "@/components/ScheduleInfusionModal";
import { ErrorModal } from "@/components/ErrorModal";
import { Progress } from "@/components/ui/progress";
import { DUMMY_DEVICE_STATE, DeviceState, Device } from "@/data/dummyData";
import {
  MapPin,
  Activity,
  Clock,
  Droplets,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Footer } from "@/components/Footer";
import { deviceApi, DeviceDetails } from "@/lib/deviceApi";
import { useAuth } from "@/hooks/useAuth";
import { useDeviceSocket } from "@/hooks/useDeviceSocket";
import audioService from "@/services/audioService";

const DeviceDashboard = () => {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(
    null
  );
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [hasRealInfusionData, setHasRealInfusionData] = useState(false);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<string | null>(
    null
  );

  // Initialize socket connection for real-time updates
  const {
    isConnected: socketConnected,
    progress: socketProgress,
    infusionConfirmation,
    infusionCompletion,
    notifications,
    activeNotification,
    clearInfusionConfirmation,
    clearInfusionCompletion,
    clearActiveNotification,
    dismissNotification,
  } = useDeviceSocket(deviceId, { autoConnect: true });

  const fetchDeviceData = useCallback(async () => {
    if (!deviceId) {
      navigate("/");
      return;
    }

    // Check if user has access to this device
    if (user?.role === "attendee" && user.deviceId !== deviceId) {
      setError(
        "Access denied: You don't have permission to access this device"
      );
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setHasRealInfusionData(false); // Reset flag

      // Fetch real device details for the top ribbon
      const realDeviceDetails = await deviceApi.getDeviceDetails(deviceId);
      setDeviceDetails(realDeviceDetails);

      // If device has active infusion and is running/paused, fetch infusion details
      let activeInfusionDetails = null;
      if (
        realDeviceDetails.activeInfusion &&
        (realDeviceDetails.status === "running" ||
          realDeviceDetails.status === "paused")
      ) {
        try {
          // Get infusion ID (could be populated object or just ID string)
          const infusionId =
            typeof realDeviceDetails.activeInfusion === "string"
              ? realDeviceDetails.activeInfusion
              : realDeviceDetails.activeInfusion._id;

          console.log("🔍 Fetching active infusion details:", {
            deviceId,
            infusionId,
          });
          activeInfusionDetails = await deviceApi.getInfusionDetails(
            deviceId,
            infusionId
          );
          setHasRealInfusionData(true);
          console.log(
            "✅ Active infusion details loaded:",
            activeInfusionDetails
          );
          console.log(
            "📋 Patient details skipped:",
            activeInfusionDetails.patientDetailSkipped
          );
        } catch (infusionError) {
          console.error(
            "❌ Failed to fetch active infusion details:",
            infusionError
          );
        }
      }

      // Get dummy data for the rest of the functionality
      const dummyDevice = DUMMY_DEVICE_STATE[deviceId];
      if (!dummyDevice) {
        console.log("❌ Device Not Found in Dummy Data", {
          type: "device_not_found",
          deviceId,
          at: new Date().toISOString(),
        });
        // Use real device data to create basic state
        setDeviceState({
          deviceId: realDeviceDetails.deviceId,
          location: realDeviceDetails.location,
          status:
            realDeviceDetails.status === "running"
              ? "Running"
              : realDeviceDetails.status === "healthy"
                ? "Healthy"
                : realDeviceDetails.status === "issue"
                  ? "Issue"
                  : realDeviceDetails.status === "degraded"
                    ? "Degraded"
                    : realDeviceDetails.status === "paused"
                      ? "Paused"
                      : "Healthy", // Show paused as Paused
          notifications: [], // Will be populated by socket notifications
          logs: [],
          patient: activeInfusionDetails
            ? activeInfusionDetails.patientDetailSkipped
              ? null // No patient data when skipped
              : activeInfusionDetails.patient || null
            : null,
          infusion: activeInfusionDetails
            ? {
                flowRateMlMin:
                  activeInfusionDetails.infusion_detail.flowRateMlMin,
                plannedTimeMin:
                  activeInfusionDetails.infusion_detail.plannedTimeMin,
                plannedVolumeMl:
                  activeInfusionDetails.infusion_detail.plannedVolumeMl,
                bolus: activeInfusionDetails.infusion_detail.bolus,
              }
            : null,
          progress: null, // Will be updated with real-time data
        });
      } else {
        // Update dummy data with real device info and active infusion if available
        setDeviceState({
          ...dummyDevice,
          deviceId: realDeviceDetails.deviceId,
          location: realDeviceDetails.location,
          status:
            realDeviceDetails.status === "running"
              ? "Running"
              : realDeviceDetails.status === "healthy"
                ? "Healthy"
                : realDeviceDetails.status === "issue"
                  ? "Issue"
                  : realDeviceDetails.status === "degraded"
                    ? "Degraded"
                    : realDeviceDetails.status === "paused"
                      ? "Paused"
                      : "Healthy", // Show paused as Paused
          notifications: [], // Use real notifications from API
          // Override with real infusion data if available
          patient: activeInfusionDetails
            ? activeInfusionDetails.patientDetailSkipped
              ? null // No patient data when skipped
              : activeInfusionDetails.patient || dummyDevice.patient
            : dummyDevice.patient,
          infusion: activeInfusionDetails
            ? {
                flowRateMlMin:
                  activeInfusionDetails.infusion_detail.flowRateMlMin,
                plannedTimeMin:
                  activeInfusionDetails.infusion_detail.plannedTimeMin,
                plannedVolumeMl:
                  activeInfusionDetails.infusion_detail.plannedVolumeMl,
                bolus: activeInfusionDetails.infusion_detail.bolus,
              }
            : dummyDevice.infusion,
        });
      }

      console.log("✅ Device Data Loaded", {
        deviceId,
        status: realDeviceDetails.status,
        location: realDeviceDetails.location,
        hasActiveInfusion: !!realDeviceDetails.activeInfusion,
        activeInfusionId: realDeviceDetails.activeInfusion
          ? typeof realDeviceDetails.activeInfusion === "string"
            ? realDeviceDetails.activeInfusion
            : realDeviceDetails.activeInfusion._id
          : null,
        infusionDetailsLoaded: !!activeInfusionDetails,
        patientDetailsSkipped:
          activeInfusionDetails?.patientDetailSkipped || false,
        hasPatientData: !!activeInfusionDetails?.patient,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load device details";
      setError(errorMessage);
      console.log("❌ Device Data Load Failed", {
        deviceId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, navigate, user]);

  useEffect(() => {
    fetchDeviceData();
  }, [fetchDeviceData]);

  // Handle real-time progress updates from socket
  useEffect(() => {
    if (
      socketProgress &&
      deviceState?.infusion &&
      deviceState?.status === "Running"
    ) {
      console.log("📈 Received real-time progress update:", socketProgress);

      setDeviceState((prev) =>
        prev
          ? {
              ...prev,
              progress: {
                mode: prev.progress?.mode || "time",
                timeRemainingMin: socketProgress.timeRemainingMin,
                volumeRemainingMl: socketProgress.volumeRemainingMl,
              },
            }
          : null
      );

      setLastProgressUpdate(new Date().toLocaleTimeString());
    }
  }, [socketProgress, deviceState?.infusion, deviceState?.status]);

  // Handle notification sound alerts
  useEffect(() => {
    if (notifications.length > 0) {
      const latestNotification = notifications[notifications.length - 1];
      console.log("🔊 Playing notification sound for:", latestNotification);
      audioService.playNotificationSound(latestNotification.priority);
    }
  }, [notifications]);

  // Handle error modal display with sound alert
  useEffect(() => {
    if (activeNotification) {
      console.log("🚨 Playing error modal sound for:", activeNotification);
      // Play sound immediately when error modal appears
      audioService.playNotificationSound(activeNotification.priority);
    }
  }, [activeNotification]);

  // Handle infusion confirmation from socket
  useEffect(() => {
    if (infusionConfirmation && deviceId) {
      console.log(
        "💉 Received infusion confirmation via socket:",
        infusionConfirmation
      );

      // Refetch device data to get updated status and infusion details
      fetchDeviceData();

      // Clear the confirmation to prevent repeated processing
      clearInfusionConfirmation();
    }
  }, [
    infusionConfirmation,
    deviceId,
    fetchDeviceData,
    clearInfusionConfirmation,
  ]);

  // Handle infusion completion from socket
  useEffect(() => {
    if (infusionCompletion && deviceId) {
      console.log(
        "🏁 Received infusion completion via socket:",
        infusionCompletion
      );

      // Update device state immediately to show completion
      setDeviceState((prev) =>
        prev
          ? {
              ...prev,
              status: "Healthy", // Device returns to healthy after completion
              infusion: null, // Clear infusion data
              progress: null, // Clear progress data
              patient: null, // Clear patient data (optional - you may want to keep this)
            }
          : null
      );

      // Refetch device data to get updated status from backend
      fetchDeviceData();

      // Clear the completion to prevent repeated processing
      clearInfusionCompletion();

      // Show completion notification (optional)
      console.log("✅ Infusion completed successfully!", {
        deviceId,
        summary: infusionCompletion.summary,
        completedAt: infusionCompletion.completedAt,
      });
    }
  }, [infusionCompletion, deviceId, fetchDeviceData, clearInfusionCompletion]);

  const handleDeleteNotification = (id: string) => {
    if (!deviceState) return;
    setDeviceState({
      ...deviceState,
      notifications: deviceState.notifications.filter((n) => n.id !== id),
    });
    // Also dismiss from socket notifications
    dismissNotification(id);
  };

  // Convert DeviceNotifications to legacy Notification format for NotificationsPopover
  const convertToLegacyNotifications = () => {
    const legacyNotifications = deviceState?.notifications || [];
    const socketNotifications = notifications.map((notification) => ({
      id: notification.id,
      ts: notification.timestamp,
      text: `${notification.title}: ${notification.message}`,
    }));
    return [...legacyNotifications, ...socketNotifications];
  };

  const handleUpdateDevice = async (
    deviceId: string,
    updates: Partial<Device>
  ) => {
    if (!deviceState || !deviceDetails) return;

    // Update local state immediately for UI responsiveness
    setDeviceState({
      ...deviceState,
      ...updates,
    });

    // Refresh device details from API to get real status
    try {
      const updatedDetails = await deviceApi.getDeviceDetails(deviceId);
      setDeviceDetails(updatedDetails);

      // Update device state with real status
      setDeviceState((prev) =>
        prev
          ? {
              ...prev,
              status:
                updatedDetails.status === "running"
                  ? "Running"
                  : updatedDetails.status === "healthy"
                    ? "Healthy"
                    : updatedDetails.status === "issue"
                      ? "Issue"
                      : updatedDetails.status === "degraded"
                        ? "Degraded"
                        : updatedDetails.status === "paused"
                          ? "Paused"
                          : "Healthy",
            }
          : null
      );
    } catch (err) {
      console.error("Failed to refresh device details:", err);
    }
  };

  const handleDeviceAction = async (
    action: "stop" | "pause" | "resume",
    params?: { reason?: string; emergency?: boolean }
  ) => {
    if (!deviceId || !deviceDetails) return;

    try {
      setActionLoading(action);
      console.log(`🔄 Device Action: ${action}`, {
        deviceId,
        action,
        params,
        timestamp: new Date().toISOString(),
      });

      switch (action) {
        case "stop":
          await deviceApi.stopInfusion(deviceId, params);
          break;
        case "pause":
          await deviceApi.pauseInfusion(deviceId, params);
          break;
        case "resume":
          await deviceApi.resumeInfusion(deviceId);
          break;
      }

      // Refresh device details after action
      const updatedDetails = await deviceApi.getDeviceDetails(deviceId);
      setDeviceDetails(updatedDetails);

      // Update device state with new status
      setDeviceState((prev) =>
        prev
          ? {
              ...prev,
              status:
                updatedDetails.status === "running"
                  ? "Running"
                  : updatedDetails.status === "healthy"
                    ? "Healthy"
                    : updatedDetails.status === "issue"
                      ? "Issue"
                      : updatedDetails.status === "degraded"
                        ? "Degraded"
                        : updatedDetails.status === "paused"
                          ? "Paused"
                          : "Healthy",
            }
          : null
      );

      console.log(`✅ Device Action Success: ${action}`, {
        deviceId,
        newStatus: updatedDetails.status,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : `Failed to ${action} infusion`;
      console.error(`❌ Device Action Failed: ${action}`, {
        deviceId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      // TODO: Show error toast/notification to user
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartInfusion = async (params: {
    flowRateMlMin: number;
    plannedTimeMin: number;
    plannedVolumeMl: number;
    bolus?: { enabled: boolean; volumeMl: number };
    patient?: {
      name: string;
      age: number;
      weight: number;
      bedNo: string;
      drugInfused: string;
      allergies: string;
    };
  }) => {
    if (!deviceId || !deviceDetails) return;

    try {
      console.log("🚀 Starting Infusion", {
        deviceId,
        params,
        hasPatientData: !!params.patient,
        timestamp: new Date().toISOString(),
      });

      await deviceApi.startInfusion(deviceId, params);

      // Refresh device details after starting
      const updatedDetails = await deviceApi.getDeviceDetails(deviceId);
      setDeviceDetails(updatedDetails);

      // Update device state with new status and infusion details
      setDeviceState((prev) =>
        prev
          ? {
              ...prev,
              status:
                updatedDetails.status === "running"
                  ? "Running"
                  : updatedDetails.status === "healthy"
                    ? "Healthy"
                    : updatedDetails.status === "issue"
                      ? "Issue"
                      : updatedDetails.status === "degraded"
                        ? "Degraded"
                        : updatedDetails.status === "paused"
                          ? "Paused"
                          : "Healthy",
              infusion: {
                flowRateMlMin: params.flowRateMlMin,
                plannedTimeMin: params.plannedTimeMin,
                plannedVolumeMl: params.plannedVolumeMl,
                bolus: params.bolus || { enabled: false, volumeMl: 0 },
              },
              // Add some mock progress for running infusions with simulated time passage
              progress:
                updatedDetails.status === "running"
                  ? {
                      mode: "time" as const,
                      timeRemainingMin: Math.max(
                        0,
                        params.plannedTimeMin - 0.5
                      ), // Simulate 0.5 min elapsed
                      volumeRemainingMl: Math.max(
                        0,
                        params.plannedVolumeMl - params.flowRateMlMin * 0.5
                      ), // Simulate volume delivered
                    }
                  : null,
            }
          : null
      );

      console.log("✅ Infusion Started Successfully", {
        deviceId,
        newStatus: updatedDetails.status,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to start infusion";
      console.error("❌ Infusion Start Failed", {
        deviceId,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      // TODO: Show error toast/notification to user
    }
  };

  const handleToggleProgress = () => {
    if (!deviceState?.progress) return;
    const newMode = deviceState.progress.mode === "time" ? "volume" : "time";
    console.log("🔄 Toggle Progress Mode", {
      type: "progress_view_toggle",
      deviceId: deviceState.deviceId,
      from: deviceState.progress.mode,
      to: newMode,
      at: new Date().toISOString(),
    });
    setDeviceState({
      ...deviceState,
      progress: {
        ...deviceState.progress,
        mode: newMode,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading device details...</p>
        </div>
      </div>
    );
  }

  if (error || !deviceDetails || !deviceState) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="glass max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <Activity className="h-16 w-16 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-2xl font-bold">Device Access Error</h2>
              <p className="text-muted-foreground mt-2">
                {error || `The device ${deviceId} could not be found.`}
              </p>
            </div>
            <Button
              onClick={() => navigate(user?.role === "admin" ? "/admin" : "/")}
            >
              {user?.role === "admin" ? "Back to Admin" : "Back to Login"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const deviceAsDevice: Device = {
    deviceId: deviceState.deviceId,
    status: deviceState.status,
    infusionsCompleted: 0,
    lastOnline: new Date().toISOString(),
    patient: deviceState.patient,
    infusion: deviceState.infusion,
    progress: deviceState.progress,
  };

  const progressPercent = (() => {
    if (!deviceState.progress || !deviceState.infusion) return 0;

    let percent = 0;
    if (deviceState.progress.mode === "time") {
      // Time-based progress: (remaining time / total time) * 100 - decreasing bar
      percent =
        deviceState.infusion.plannedTimeMin > 0
          ? (deviceState.progress.timeRemainingMin /
              deviceState.infusion.plannedTimeMin) *
            100
          : 0;

      console.log("🔢 Time Progress Calculation (Remaining)", {
        plannedTime: deviceState.infusion.plannedTimeMin,
        timeRemaining: deviceState.progress.timeRemainingMin,
        percent: percent.toFixed(1),
        note: "Bar shows remaining time (decreases as infusion progresses)",
      });
    } else {
      // Volume-based progress: (remaining volume / total volume) * 100 - decreasing bar
      percent =
        deviceState.infusion.plannedVolumeMl > 0
          ? (deviceState.progress.volumeRemainingMl /
              deviceState.infusion.plannedVolumeMl) *
            100
          : 0;

      console.log("🔢 Volume Progress Calculation (Remaining)", {
        plannedVolume: deviceState.infusion.plannedVolumeMl,
        volumeRemaining: deviceState.progress.volumeRemainingMl,
        percent: percent.toFixed(1),
        note: "Bar shows remaining volume (decreases as infusion progresses)",
      });
    }

    // Ensure percentage is between 0 and 100
    return Math.max(0, Math.min(100, percent));
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Device Info Card - Using Real API Data */}
      <Card className="glass">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl flex items-center gap-3">
                <Activity className="h-6 w-6 text-primary" />
                {deviceDetails.deviceId}
              </CardTitle>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{deviceDetails.location}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  Last updated:{" "}
                  {new Date(deviceDetails.updatedAt).toLocaleString()}
                </span>
                {lastProgressUpdate && (
                  <>
                    <span>•</span>
                    <span>Progress: {lastProgressUpdate}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Real-time connection indicator */}
              <div className="flex items-center gap-1 text-xs">
                {socketConnected ? (
                  <>
                    <Wifi className="h-3 w-3 text-green-500" />
                    <span className="text-green-600 dark:text-green-400">
                      Live
                    </span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3 text-gray-400" />
                    <span className="text-gray-500">Offline</span>
                  </>
                )}
              </div>
              <NotificationsPopover
                notifications={convertToLegacyNotifications()}
                onDelete={handleDeleteNotification}
                deviceId={deviceDetails.deviceId}
              />
              <StatusChip status={deviceState.status} />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Running/Paused State */}
      {(deviceState.status === "Running" || deviceState.status === "Paused") &&
        deviceState.infusion && (
          <div className="space-y-6">
            {/* Controls - First */}
            <Card className="glass">
              <CardHeader>
                <CardTitle>Controls</CardTitle>
                {deviceState.status === "Paused" && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg mt-2">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      ⏸️ Infusion is currently paused
                    </p>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <RunningDeviceActions
                  device={deviceAsDevice}
                  onUpdateDevice={handleUpdateDevice}
                  onDeviceAction={handleDeviceAction}
                  actionLoading={actionLoading}
                  isPaused={deviceState.status === "Paused"}
                />
              </CardContent>
            </Card>

            {/* Progress - Second */}
            {deviceState.progress && (
              <Card className="glass">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Progress</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleProgress}
                    >
                      Switch to{" "}
                      {deviceState.progress.mode === "time" ? "Volume" : "Time"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {deviceState.progress.mode === "time" ? (
                        <>
                          <Clock className="h-5 w-5 text-primary" />
                          <span className="font-medium">Time Remaining</span>
                        </>
                      ) : (
                        <>
                          <Droplets className="h-5 w-5 text-primary" />
                          <span className="font-medium">Volume Remaining</span>
                        </>
                      )}
                    </div>
                    <span className="text-2xl font-bold text-primary">
                      {deviceState.progress.mode === "time"
                        ? `${deviceState.progress.timeRemainingMin} / ${deviceState.infusion.plannedTimeMin} min`
                        : `${deviceState.progress.volumeRemainingMl} / ${deviceState.infusion.plannedVolumeMl} ml`}
                    </span>
                  </div>
                  <Progress value={progressPercent} className="h-3" />
                  <p className="text-sm text-muted-foreground text-center">
                    {(100 - progressPercent).toFixed(1)}% completed •{" "}
                    {progressPercent.toFixed(1)}% remaining
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Patient & Infusion Details - Third */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="glass">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Patient Information
                    </CardTitle>
                    {hasRealInfusionData &&
                      deviceState.patient &&
                      !deviceState.patient.name?.includes("Dummy") && (
                        <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                          ✅ Live Data
                        </div>
                      )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {deviceState.patient ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Name</p>
                        <p className="font-medium">
                          {deviceState.patient.name}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Age</p>
                        <p className="font-medium">
                          {deviceState.patient.age} years
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Weight</p>
                        <p className="font-medium">
                          {deviceState.patient.weight} kg
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Bed No.</p>
                        <p className="font-medium">
                          {deviceState.patient.bedNo}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Drug</p>
                        <p className="font-medium">
                          {deviceState.patient.drugInfused || "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Allergies
                        </p>
                        <p className="font-medium">
                          {deviceState.patient.allergies || "None"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                        <p className="text-lg font-medium text-muted-foreground mb-2">
                          Patient Details Skipped
                        </p>
                        <p className="text-sm text-muted-foreground">
                          This infusion was started without patient information
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Infusion Details</CardTitle>
                    {hasRealInfusionData && (
                      <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                        ✅ Live Data
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Flow Rate</p>
                      <p className="font-medium">
                        {deviceState.infusion.flowRateMlMin} ml/min
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Planned Time
                      </p>
                      <p className="font-medium">
                        {deviceState.infusion.plannedTimeMin} min
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Planned Volume
                      </p>
                      <p className="font-medium">
                        {deviceState.infusion.plannedVolumeMl} ml
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Bolus</p>
                      <p className="font-medium">
                        {deviceState.infusion.bolus.enabled
                          ? `${deviceState.infusion.bolus.volumeMl} ml`
                          : "Disabled"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

      {/* Healthy/Stopped State - Can Start Infusion */}
      {(deviceState.status === "Healthy" ||
        deviceDetails?.status === "stopped") &&
        deviceState.status !== "Paused" && (
          <Card className="glass">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    console.log("🚀 Open Start Infusion Wizard", {
                      deviceId: deviceState.deviceId,
                      timestamp: new Date().toISOString(),
                    });
                    setWizardOpen(true);
                  }}
                  className="flex-1 min-w-[200px] h-12"
                >
                  <Activity className="mr-2 h-4 w-4" />
                  Start Infusion
                </Button>
                <Button
                  onClick={() => {
                    console.log("📅 Open Schedule Infusion", {
                      deviceId: deviceState.deviceId,
                      timestamp: new Date().toISOString(),
                    });
                    setScheduleOpen(true);
                  }}
                  variant="outline"
                  className="flex-1 min-w-[200px] h-12"
                  disabled
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Schedule Infusion
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Other Status States */}
      {(deviceState.status === "Issue" ||
        deviceState.status === "Degraded") && (
        <Card className="glass border-destructive/50">
          <CardContent className="pt-6 text-center space-y-2">
            <p className="font-semibold text-destructive">
              Device requires attention
            </p>
            <p className="text-sm text-muted-foreground">
              Please contact maintenance or technical support
            </p>
          </CardContent>
        </Card>
      )}

      <StartInfusionWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        device={deviceAsDevice}
        onUpdateDevice={handleUpdateDevice}
        onStartInfusion={handleStartInfusion}
        onRefetchDeviceDetails={fetchDeviceData}
      />

      <ScheduleInfusionModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        deviceId={deviceState.deviceId}
      />

      <ErrorModal
        notification={activeNotification}
        isOpen={!!activeNotification}
        onClose={clearActiveNotification}
        onAcknowledge={() => {
          if (activeNotification) {
            dismissNotification(activeNotification.id);
          }
        }}
      />

      <Footer />
    </div>
  );
};

export default DeviceDashboard;
