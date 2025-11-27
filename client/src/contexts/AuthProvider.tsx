import React, { useEffect, useState, ReactNode } from "react";
import { authService, User } from "@/lib/auth";
import { AuthContext, AuthContextType } from "./auth";

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated on app load
    const currentUser = authService.getCurrentUser();
    const isAuth = authService.isAuthenticated();

    if (isAuth && currentUser) {
      setUser(currentUser);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string, deviceId?: string) => {
    try {
      setIsLoading(true);
      const { user: loggedInUser } = await authService.login({
        email,
        password,
        deviceId,
      });
      setUser(loggedInUser);
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const updateUser = async (userData: { name?: string; email?: string }) => {
    try {
      const updatedUser = await authService.updateUser(userData);
      setUser(updatedUser);
    } catch (error) {
      console.error("Update user failed:", error);
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user && authService.isAuthenticated(),
    isLoading,
    login,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
