import api from "./api";

export interface LoginCredentials {
  email: string;
  password: string;
  deviceId?: string;
}

export interface User {
  id: string;
  email: string;
  role: "admin" | "attendee";
  deviceId?: string;
}

export interface AuthResponse {
  token: string;
}

interface ApiError {
  response?: {
    data?: {
      message?: string;
    };
  };
}

class AuthService {
  // Login user (admin or attendee)
  async login(
    credentials: LoginCredentials
  ): Promise<{ token: string; user: User }> {
    try {
      const response = await api.post<{ data: AuthResponse; message: string }>(
        "/auth/login",
        credentials
      );
      const { token } = response.data.data;

      // Decode JWT to get user info (basic decode without verification since backend handles security)
      const payload = JSON.parse(atob(token.split(".")[1]));
      const user: User = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        ...(payload.deviceId && { deviceId: payload.deviceId }),
      };

      // Store token and user data
      localStorage.setItem("auth_token", token);
      localStorage.setItem("user_data", JSON.stringify(user));

      return { token, user };
    } catch (error: unknown) {
      console.error("Login error:", error);
      const errorMessage =
        (error as ApiError).response?.data?.message || "Login failed";
      throw new Error(errorMessage);
    }
  }

  // Create new user (registration)
  async createUser(userData: {
    name: string;
    email: string;
    passWord: string;
    role: "admin" | "attendee";
  }): Promise<void> {
    try {
      await api.post("/auth/create", userData);
    } catch (error: unknown) {
      console.error("Create user error:", error);
      const errorMessage =
        (error as ApiError).response?.data?.message || "User creation failed";
      throw new Error(errorMessage);
    }
  }

  // Update user
  async updateUser(userData: { name?: string; email?: string }): Promise<User> {
    try {
      const response = await api.patch("/auth/update", userData);
      const updatedUser = response.data.data.user;

      // Update stored user data
      const currentUser = this.getCurrentUser();
      if (currentUser) {
        const newUserData = { ...currentUser, ...updatedUser };
        localStorage.setItem("user_data", JSON.stringify(newUserData));
        return newUserData;
      }

      return updatedUser;
    } catch (error: unknown) {
      console.error("Update user error:", error);
      const errorMessage =
        (error as ApiError).response?.data?.message || "User update failed";
      throw new Error(errorMessage);
    }
  }

  // Logout user
  logout(): void {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_data");
  }

  // Get current user from localStorage
  getCurrentUser(): User | null {
    try {
      const userData = localStorage.getItem("user_data");
      return userData ? JSON.parse(userData) : null;
    } catch {
      return null;
    }
  }

  // Get current token
  getToken(): string | null {
    return localStorage.getItem("auth_token");
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    const token = this.getToken();
    const user = this.getCurrentUser();
    return !!(token && user);
  }

  // Check if user has specific role
  hasRole(role: "admin" | "attendee"): boolean {
    const user = this.getCurrentUser();
    return user?.role === role;
  }
}

export const authService = new AuthService();
