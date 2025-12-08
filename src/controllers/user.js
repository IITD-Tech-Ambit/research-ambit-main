import { BadRequestError, ValidationError, InternalServerError, NotFoundError } from "../lib/customErrors.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { successResponse } from "../lib/responseUtils.js";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import User from "../models/user.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary.js";

let user = {};


user.register = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    let { name, email, password, role } = req.body;
    let profile_img = req.body.profile_img || "";

    if (req.file) {
        const uploadedUrl = await uploadToCloudinary(req.file.path, 'users');
        if (uploadedUrl) {
            profile_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }
    const errors = [];
    if (!name) {
        errors.push({
            field: 'name',
            message: 'Name is required'
        })
    }
    if (!email) {
        errors.push({
            field: 'email',
            message: 'Email is required'
        })
    }
    if (!password) {
        errors.push({
            field: 'password',
            message: 'Password is required'
        })
    }
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    password = hashedPassword;
    const user = await User.create({ name, email, password, profile_img, role });
    if (!user) {
        throw new InternalServerError("Failed to create user");
    }
    return successResponse(res, user, "User created successfully", 201);
});

user.login = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { email, password } = req.body;
    const errors = [];
    if (!email) {
        errors.push({
            field: 'email',
            message: 'Email is required'
        })
    }
    if (!password) {
        errors.push({
            field: 'password',
            message: 'Password is required'
        })
    }
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
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role, }, process.env.JWT_SECRET, {
        expiresIn: '1h' //TODO: Change this to 30min..
    });
    return successResponse(res, { "token": token }, "Login successful", 200);
});

user.editUser = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { name, password } = req.body;
    let profile_img = req.body.profile_img || "";

    if (req.file) {
        const uploadedUrl = await uploadToCloudinary(req.file.path, 'users');
        if (uploadedUrl) {
            profile_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }

    if (!name && !password && !profile_img) {
        throw new ValidationError("At least one field is required", []);
    };

    const user = await User.findOne({ email: req.user.email });
    if (!user) {
        throw new NotFoundError("User not found");
    }

    if (name) {
        user.name = name;
    }
    if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
    }

    if (profile_img) {
        if (user.profile_img) {
            await deleteFromCloudinary(user.profile_img);
        }
        user.profile_img = profile_img;
    }

    await user.save();
    return successResponse(res, user, "User updated successfully", 200);

});

//Admin Only
user.deleteUser = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
        throw new NotFoundError("User not found");
    }
    if (user.profile_img) {
        await deleteFromCloudinary(user.profile_img);
    }
    await user.deleteOne();
    return successResponse(res, user, "User deleted successfully", 200);
});




export default user;

