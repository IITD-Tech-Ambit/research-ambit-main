import { useState, useEffect } from "react";
import { Outlet, useNavigate, NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Home, FileText, Menu, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isLoading } = useAuth();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true); // Start open on desktop, will be adjusted for mobile
  const [isMobile, setIsMobile] = useState(false);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768; // md breakpoint
      setIsMobile(mobile);
      // On mobile, close sidebar by default
      if (mobile) {
        setSidebarOpen(false);
      } else {
        // On desktop, open sidebar by default (if not explicitly closed)
        setSidebarOpen(true);
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close sidebar when route changes on mobile
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  const handleLogout = () => {
    console.log("🚪 Admin Logout", {
      admin: user?.email,
      timestamp: new Date().toISOString(),
    });
    logout();
    navigate("/");
  };

  const navItems = [
    { icon: Home, label: "Dashboard", path: "/admin" },
    { icon: FileText, label: "Device Logs", path: "/admin/logs" },
  ];

  const getInitials = (email: string) => {
    return email
      .split("@")[0]
      .split(".")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col w-full">
        {/* Top App Bar */}
        <header className="bg-background/80 backdrop-blur-md border-b sticky top-0 z-50">
          <div className="w-full px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                className="flex-shrink-0"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h2 className="text-lg font-semibold text-foreground truncate">
                Welcome, {user.email.split("@")[0]}
              </h2>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-10 w-10 rounded-full"
                  >
                    <Avatar className="h-10 w-10 border-2 border-primary">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                        {getInitials(user.email)}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 glass" align="end">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">
                        {user.email.split("@")[0]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin/profile")}>
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive"
                  >
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <div className="flex flex-1 w-full relative">
          {/* Mobile Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <aside
            className={cn(
              "glass border-r transition-all duration-300 flex flex-col h-[calc(100vh-4rem)] z-40",
              // Mobile: fixed positioning with slide animation
              "fixed md:sticky top-16 left-0",
              sidebarOpen
                ? "w-64 translate-x-0"
                : "w-64 -translate-x-full md:translate-x-0",
              // Desktop: change width only, no translation
              sidebarOpen ? "md:w-64" : "md:w-16",
              // Prevent overflow issues in collapsed state
              !sidebarOpen && "md:overflow-visible"
            )}
          >
            <nav
              className={cn(
                "flex-1 space-y-2",
                sidebarOpen ? "p-4" : "px-2 py-4"
              )}
            >
              {navItems.map((item) => {
                const navContent = (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/admin"}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-xl transition-all hover:bg-accent text-foreground font-medium",
                        isActive &&
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                        sidebarOpen
                          ? "gap-3 px-4 py-3"
                          : "justify-center p-2 w-12 h-12 mx-auto"
                      )
                    }
                  >
                    <item.icon
                      className={cn(
                        "h-5 w-5 flex-shrink-0",
                        !sidebarOpen && "md:h-6 md:w-6"
                      )}
                    />
                    {sidebarOpen && (
                      <span className="whitespace-nowrap">{item.label}</span>
                    )}
                  </NavLink>
                );

                // Show tooltip only on desktop when sidebar is collapsed
                if (!sidebarOpen && !isMobile) {
                  return (
                    <Tooltip key={item.path}>
                      <TooltipTrigger asChild>{navContent}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return navContent;
              })}
            </nav>
          </aside>

          {/* Main Content */}
          <main
            className={cn(
              "flex-1 p-4 md:p-6 lg:p-8 w-full transition-all duration-300",
              // On mobile, add margin when sidebar is open, on desktop no margin needed as sidebar is sticky
              sidebarOpen ? "md:ml-0" : "md:ml-0",
              "min-h-[calc(100vh-4rem)]"
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default AdminLayout;
