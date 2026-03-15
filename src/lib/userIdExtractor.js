import jwt from "jsonwebtoken";

export const getUserId = (token) => {
    if (!token) {
        return null;
    }
    if (!token || !token.startsWith("Bearer ")) {
        return null;
    }

    const mainToken = token.split(" ")[1];

    try {
        const decoded = jwt.verify(mainToken, process.env.JWT_SECRET);
        return decoded.id;
    } catch (error) {
        return null;
    }
}