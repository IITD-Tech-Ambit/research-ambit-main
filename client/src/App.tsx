import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import AdminLayout from "./components/AdminLayout";
import AdminDashboard from "./pages/AdminDashboard";
import DeviceLogs from "./pages/DeviceLogs";
import Profile from "./pages/Profile";
import DeviceLayout from "./components/DeviceLayout";
import DeviceDashboard from "./pages/DeviceDashboard";
import DeviceLogsPage from "./pages/DeviceLogsPage";
import DeviceProfile from "./pages/DeviceProfile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/login/:deviceId" element={<Login />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="logs" element={<DeviceLogs />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            <Route
              path="/device/:deviceId"
              element={
                <ProtectedRoute requiredRole="attendee">
                  <DeviceLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DeviceDashboard />} />
              <Route path="logs" element={<DeviceLogsPage />} />
              <Route path="profile" element={<DeviceProfile />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
