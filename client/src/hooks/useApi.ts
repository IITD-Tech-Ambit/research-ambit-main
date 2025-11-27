import { useState } from "react";
import api from "@/lib/api";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export const useApi = <T = unknown>() => {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = async (apiCall: () => Promise<T>): Promise<T | null> => {
    setState({ data: null, loading: true, error: null });

    try {
      const result = await apiCall();
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An error occurred";
      setState({ data: null, loading: false, error: errorMessage });
      return null;
    }
  };

  const reset = () => {
    setState({ data: null, loading: false, error: null });
  };

  return {
    ...state,
    execute,
    reset,
  };
};

// Specific API hooks
export const useDeviceApi = () => {
  const { execute, loading, error } = useApi();

  const getDevices = () =>
    execute(() => api.get("/device").then((res) => res.data.data));

  const getDevice = (deviceId: string) =>
    execute(() => api.get(`/device/${deviceId}`).then((res) => res.data.data));

  const updateDevice = (deviceId: string, data: Record<string, unknown>) =>
    execute(() =>
      api.put(`/device/${deviceId}`, data).then((res) => res.data.data)
    );

  return {
    getDevices,
    getDevice,
    updateDevice,
    loading,
    error,
  };
};
