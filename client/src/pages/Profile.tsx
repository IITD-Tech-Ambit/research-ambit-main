import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DUMMY_ADMIN } from "@/data/dummyData";
import { User, Save } from "lucide-react";
import { toast } from "sonner";
import { Footer } from "@/components/Footer";

const Profile = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: DUMMY_ADMIN.name,
    email: DUMMY_ADMIN.email,
  });

  const handleSave = () => {
    console.log("💾 Profile Updated", {
      ...formData,
      timestamp: new Date().toISOString(),
    });
    setIsEditing(false);
    toast.success("Profile updated successfully");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
          Admin Profile
        </h1>
        <p className="text-muted-foreground">Manage your account information</p>
      </div>

      <Card className="glass border-2 max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg">
              <User className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <CardTitle>Account Details</CardTitle>
              <CardDescription>
                Your administrator account information
              </CardDescription>
            </div>
            {!isEditing && (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="h-12"
                />
              ) : (
                <p className="h-12 flex items-center px-3 bg-muted rounded-lg font-semibold">
                  {formData.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              {isEditing ? (
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="h-12"
                />
              ) : (
                <p className="h-12 flex items-center px-3 bg-muted rounded-lg font-semibold">
                  {formData.email}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <p className="h-12 flex items-center px-3 bg-muted rounded-lg font-semibold">
                Administrator
              </p>
            </div>

            <div className="space-y-2">
              <Label>Last Login</Label>
              <p className="h-12 flex items-center px-3 bg-muted rounded-lg font-semibold">
                {new Date(DUMMY_ADMIN.lastLogin).toLocaleString()}
              </p>
            </div>

            {isEditing && (
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setFormData({
                      name: DUMMY_ADMIN.name,
                      email: DUMMY_ADMIN.email,
                    });
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} className="flex-1">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Footer />
    </div>
  );
};

export default Profile;
