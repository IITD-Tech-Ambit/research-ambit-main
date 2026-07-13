/**
 * directory.v1.UserService handlers (CMS accounts — NOT IITD OAuth). Register/
 * Edit/Delete echo raw Mongoose user docs, so they ride JsonDataResponse;
 * Login returns the typed { token }. Edit/Delete re-run the same JWT/role gate
 * the REST middleware applies (any-user for edit, admin for delete).
 */
import { unary } from "../handlerUtils.js";
import { requireAuth } from "../grpcAuth.js";
import { writeUploadToTemp } from "../fileUpload.js";

export function createUserHandlers(userService) {
    return {
        Register: unary(async ({ request: r }) => {
            const { data } = await userService.register({
                name: r.name,
                email: r.email,
                password: r.password,
                role: r.role,
                profileImgPath: writeUploadToTemp(r.profile_img),
                profileImgUrl: r.profile_img_url,
            });
            return { data_json: JSON.stringify(data) };
        }),

        Login: unary(async ({ request: r }) => {
            const { data } = await userService.login({ email: r.email, password: r.password });
            return { token: data.token };
        }),

        EditUser: unary(async ({ request: r, metadata }) => {
            const authUser = requireAuth(metadata, []);
            const { data } = await userService.editUser(
                {
                    name: r.name,
                    password: r.password,
                    profileImgPath: writeUploadToTemp(r.profile_img),
                    profileImgUrl: r.profile_img_url,
                },
                authUser,
            );
            return { data_json: JSON.stringify(data) };
        }),

        DeleteUser: unary(async ({ request: r, metadata }) => {
            requireAuth(metadata, ["admin"]);
            const { data } = await userService.deleteUser({ email: r.email });
            return { data_json: JSON.stringify(data) };
        }),
    };
}
