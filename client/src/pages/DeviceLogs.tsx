import { useState } from "react";
import { DUMMY_LOGS, DeviceLog } from "@/data/dummyData";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/Footer";

const DeviceLogs = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [logs] = useState<DeviceLog[]>(DUMMY_LOGS);

  const filteredLogs = logs.filter(
    (log) =>
      log.deviceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.note.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case "start":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "pause":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      case "resume":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "stop":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      case "schedule":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
          Device Logs
        </h1>
        <p className="text-muted-foreground">
          View activity history for all devices
        </p>
      </div>

      <Card className="glass border-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>
                Complete history of device operations
              </CardDescription>
            </div>
          </div>
          <div className="pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs by device, action, or actor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-12"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-sm">
                    Timestamp
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">
                    Device ID
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">
                    Action
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">
                    Actor
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No logs found matching your search
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, index) => (
                    <tr
                      key={index}
                      className="border-b hover:bg-accent/30 transition-colors"
                    >
                      <td className="py-3 px-4 text-sm">
                        {new Date(log.ts).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm font-semibold">
                          {log.deviceId}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge className={getActionColor(log.action)}>
                          {log.action.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm">{log.actor}</td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {log.note}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Footer />
    </div>
  );
};

export default DeviceLogs;
