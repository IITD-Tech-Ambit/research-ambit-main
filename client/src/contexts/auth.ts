import { createContext } from "react";
import { User } from "@/lib/auth";

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, deviceId?: string) => Promise<void>;
  logout: () => void;
  updateUser: (userData: { name?: string; email?: string }) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);
