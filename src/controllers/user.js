import { BadRequestError, ValidationError, InternalServerError, NotFoundError } from "../lib/customErrors.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { successResponse } from "../lib/responseUtils.js";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import User from "../models/user.js";

let user = {};


user.register = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    let { email, password, profile_img, role } = req.body;
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
    if (!role) {
        errors.push({
            field: 'role',
            message: 'Role is required'
        })
    }
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    password = hashedPassword;
    const user = await User.create({ email, password, profile_img, role });
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
    const { email, password, profile_img } = req.body;
    if (!email && !password && !profile_img) {
        throw new ValidationError("At least one field is required", []);
    };
    if (email) {
        const user = await User.findOne({ email });
        if (!user) {
            throw new NotFoundError("User not found");
        }
        user.email = email;
        await user.save();
    }
    else if (password) {
        const user = await User.findOne({ email });
        if (!user) {
            throw new NotFoundError("User not found");
        }
        user.password = password;
        await user.save();
    } else {
        const user = await User.findOne({ email });
        if (!user) {
            throw new NotFoundError("User not found");
        }
        user.profile_img = profile_img;
        await user.save();
    }
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
    await user.deleteOne();
    return successResponse(res, user, "User deleted successfully", 200);
});




export default user;

