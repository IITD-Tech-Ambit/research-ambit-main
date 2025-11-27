import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { DUMMY_DEVICE_STATE, DeviceLog } from "@/data/dummyData";
import { Footer } from "@/components/Footer";

const DeviceLogsPage = () => {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!deviceId) {
      navigate("/");
      return;
    }

    const device = DUMMY_DEVICE_STATE[deviceId];
    if (!device) {
      console.log("❌ Device Not Found", {
        type: "device_not_found",
        deviceId,
        at: new Date().toISOString(),
      });
      navigate("/");
      return;
    }

    setLogs(device.logs || []);
  }, [deviceId, navigate]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    console.log("🔍 Device Logs Search", {
      deviceId,
      query,
      timestamp: new Date().toISOString(),
    });
  };

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.note.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="glass">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">Device Logs - {deviceId}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Logs Table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Actor
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        {logs.length === 0
                          ? "No logs available for this device"
                          : "No logs match your search"}
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm">
                          {new Date(log.ts).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{log.actor}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {log.note}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Footer />
    </div>
  );
};

export default DeviceLogsPage;
