import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import * as userService from "../services/userService.js";

let user = {};

user.register = asyncErrorHandler(async (req, res) => {
    const { data, message, statusCode } = await userService.register({
        name: req.body?.name,
        email: req.body?.email,
        password: req.body?.password,
        role: req.body?.role,
        profileImgPath: req.file?.path || null,
        profileImgUrl: req.body?.profile_img,
    });
    return successResponse(res, data, message, statusCode);
});

user.login = asyncErrorHandler(async (req, res) => {
    const { data, message } = await userService.login({
        email: req.body?.email,
        password: req.body?.password,
    });
    return successResponse(res, data, message, 200);
});

user.editUser = asyncErrorHandler(async (req, res) => {
    const { data, message } = await userService.editUser({
        name: req.body?.name,
        password: req.body?.password,
        profileImgPath: req.file?.path || null,
        profileImgUrl: req.body?.profile_img,
    }, req.user);
    return successResponse(res, data, message, 200);
});

user.deleteUser = asyncErrorHandler(async (req, res) => {
    const { data, message } = await userService.deleteUser({ email: req.body?.email });
    return successResponse(res, data, message, 200);
});

export default user;
