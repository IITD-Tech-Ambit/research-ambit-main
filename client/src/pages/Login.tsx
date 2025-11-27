import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Activity, AlertCircle, Loader2 } from "lucide-react";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

const Login = () => {
  const navigate = useNavigate();
  const { deviceId: urlDeviceId } = useParams();
  const { login, isAuthenticated, user, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [attendeePassword, setAttendeePassword] = useState("");
  const [error, setError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user && !authLoading) {
      if (user.role === "admin") {
        navigate("/admin");
      } else if (user.role === "attendee" && user.deviceId) {
        navigate(`/device/${user.deviceId}`);
      }
    }
  }, [isAuthenticated, user, authLoading, navigate]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      console.log("🔐 Admin Login Success", {
        email,
        timestamp: new Date().toISOString(),
      });
      // Navigation will be handled by useEffect
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Login failed";
      setError(errorMessage);
      console.log("🔐 Admin Login Failed", {
        email,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeviceLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceError("");
    setIsLoading(true);

    if (!urlDeviceId) {
      setDeviceError("Device ID not found");
      setIsLoading(false);
      return;
    }

    if (!attendeeEmail || !attendeePassword) {
      setDeviceError("Please enter email and password");
      setIsLoading(false);
      return;
    }

    try {
      await login(attendeeEmail, attendeePassword, urlDeviceId.toUpperCase());
      console.log("🔐 Device Login Success", {
        type: "device_login_success",
        deviceId: urlDeviceId.toUpperCase(),
        attendeeEmail: attendeeEmail,
        at: new Date().toISOString(),
      });
      // Navigation will be handled by useEffect
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Login failed";
      setDeviceError(errorMessage);
      console.log("🔐 Device Login Failed", {
        type: "device_login_failed",
        deviceId: urlDeviceId,
        attendeeEmail: attendeeEmail,
        error: errorMessage,
        at: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md glass border-2">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center">
              <Activity className="w-10 h-10 text-primary-foreground" />
            </div>
            <div>
              <CardTitle className="text-3xl font-bold">MediFlow</CardTitle>
              <CardDescription className="text-base mt-2">
                Hospital Infusion Pump Management System
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {urlDeviceId ? (
              // Device-specific login page - only show device/attendee login
              <div className="space-y-4">
                <div className="bg-primary/10 p-4 rounded-lg text-center mb-4">
                  <p className="text-sm text-muted-foreground">
                    Login for device
                  </p>
                  <p className="text-xl font-bold text-primary">
                    {urlDeviceId}
                  </p>
                </div>
                <form onSubmit={handleDeviceLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="attendeeEmail">Attendee Email</Label>
                    <Input
                      id="attendeeEmail"
                      type="email"
                      placeholder="nurse.mehta@hospital.example"
                      value={attendeeEmail}
                      onChange={(e) => {
                        setAttendeeEmail(e.target.value);
                        setDeviceError("");
                      }}
                      required
                      className="h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="attendeePassword">Password</Label>
                    <Input
                      id="attendeePassword"
                      type="password"
                      placeholder="••••••••"
                      value={attendeePassword}
                      onChange={(e) => {
                        setAttendeePassword(e.target.value);
                        setDeviceError("");
                      }}
                      required
                      className="h-12"
                    />
                  </div>
                  {deviceError && (
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
                      <AlertCircle className="h-4 w-4" />
                      <span>{deviceError}</span>
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full h-12 text-base"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in to Device"
                    )}
                  </Button>
                </form>
                <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground text-center">
                  <p className="font-medium mb-1">Note:</p>
                  <p>Use valid attendee credentials for this device</p>
                </div>
              </div>
            ) : (
              // General login page - show both admin and device tabs
              <Tabs defaultValue="admin" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="admin">Admin</TabsTrigger>
                  <TabsTrigger value="device">Device/Attendee</TabsTrigger>
                </TabsList>

                <TabsContent value="admin" className="space-y-4">
                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="admin@hospital.example"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-12"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 text-base"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        "Sign in as Admin"
                      )}
                    </Button>
                  </form>
                  {error && (
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground text-center">
                    <p className="font-medium mb-1">Note:</p>
                    <p>Use valid admin credentials to access the system</p>
                  </div>
                </TabsContent>

                <TabsContent value="device" className="space-y-4">
                  <div className="text-center p-6 text-muted-foreground">
                    <p className="mb-4">
                      Please use a device-specific login URL
                    </p>
                    <p className="text-sm">Example: /login/PUMP_001</p>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
};

export default Login;
