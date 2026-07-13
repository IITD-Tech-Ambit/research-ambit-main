/**
 * CMS user (account) application service: transport-agnostic logic behind
 * /api/user/*. Extracted from controllers/user.js so REST handlers and the
 * directory.v1 UserService gRPC handlers share ONE implementation. This is the
 * CMS bcrypt/JWT identity — NOT IITD OAuth (owned by auth-service).
 *
 * Auth is resolved by the caller: editUser receives the verified `authUser`
 * ({ email }); deleteUser's admin gate is enforced upstream (authMiddleware /
 * gRPC handler), matching the current route middleware.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { BadRequestError, ValidationError, InternalServerError, NotFoundError } from "../lib/customErrors.js";
import User from "../models/user.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary.js";

export const register = async ({ name, email, password, role, profileImgPath, profileImgUrl } = {}) => {
    let profile_img = profileImgUrl || "";

    if (profileImgPath) {
        const uploadedUrl = await uploadToCloudinary(profileImgPath, 'users');
        if (uploadedUrl) {
            profile_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }
    const errors = [];
    if (!name) errors.push({ field: 'name', message: 'Name is required' });
    if (!email) errors.push({ field: 'email', message: 'Email is required' });
    if (!password) errors.push({ field: 'password', message: 'Password is required' });
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, profile_img, role });
    if (!user) {
        throw new InternalServerError("Failed to create user");
    }
    return { data: user, message: "User created successfully", statusCode: 201 };
};

export const login = async ({ email, password } = {}) => {
    const errors = [];
    if (!email) errors.push({ field: 'email', message: 'Email is required' });
    if (!password) errors.push({ field: 'password', message: 'Password is required' });
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    const user = await User.findOne({ email });
    if (!user) {
        throw new NotFoundError("User not found");
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new BadRequestError("Invalid password");
    }
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: '1h'
    });
    return { data: { token }, message: "Login successful" };
};

export const editUser = async ({ name, password, profileImgPath, profileImgUrl } = {}, authUser) => {
    let profile_img = profileImgUrl || "";

    if (profileImgPath) {
        const uploadedUrl = await uploadToCloudinary(profileImgPath, 'users');
        if (uploadedUrl) {
            profile_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }

    if (!name && !password && !profile_img) {
        throw new ValidationError("At least one field is required", []);
    }

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (name) {
        user.name = name;
    }
    if (password) {
        user.password = await bcrypt.hash(password, 10);
    }
    if (profile_img) {
        if (user.profile_img) {
            await deleteFromCloudinary(user.profile_img);
        }
        user.profile_img = profile_img;
    }

    await user.save();
    return { data: user, message: "User updated successfully" };
};

export const deleteUser = async ({ email } = {}) => {
    const user = await User.findOne({ email });
    if (!user) {
        throw new NotFoundError("User not found");
    }
    if (user.profile_img) {
        await deleteFromCloudinary(user.profile_img);
    }
    await user.deleteOne();
    return { data: user, message: "User deleted successfully" };
};
