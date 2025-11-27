import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DUMMY_ATTENDEE } from "@/data/dummyData";
import { Footer } from "@/components/Footer";

const DeviceProfile = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(DUMMY_ATTENDEE.name);
  const [email, setEmail] = useState(DUMMY_ATTENDEE.email);

  const handleSave = () => {
    console.log("💾 Device Profile Updated", {
      name,
      email,
      timestamp: new Date().toISOString(),
    });
    setIsEditing(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="glass max-w-2xl mx-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">Attendee Profile</CardTitle>
            {!isEditing && (
              <Button onClick={() => setIsEditing(true)} variant="outline">
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isEditing}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isEditing}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Input value="Attendee" disabled className="h-12" />
            </div>

            <div className="space-y-2">
              <Label>Last Login</Label>
              <Input
                value={new Date(DUMMY_ATTENDEE.lastLogin).toLocaleString()}
                disabled
                className="h-12"
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex gap-3">
              <Button onClick={handleSave} className="flex-1">
                Save Changes
              </Button>
              <Button
                onClick={() => {
                  setIsEditing(false);
                  setName(DUMMY_ATTENDEE.name);
                  setEmail(DUMMY_ATTENDEE.email);
                }}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Footer />
    </div>
  );
};

export default DeviceProfile;
