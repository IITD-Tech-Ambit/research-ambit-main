import { v2 as cloudinary } from 'cloudinary';
import createHttpsProxyAgent from 'https-proxy-agent';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

function cloudinaryAgent() {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    return proxy ? createHttpsProxyAgent(proxy) : undefined;
}

const uploadToCloudinary = async (localFilePath, folder) => {
    try {
        if (!localFilePath) return null;

        const agent = cloudinaryAgent();
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
            folder: folder,
            ...(agent ? { agent } : {})
        });

        fs.unlinkSync(localFilePath);
        return response.secure_url || response.url;
    } catch (error) {
        console.error("Cloudinary upload failed:", error?.message || error);
        try { fs.unlinkSync(localFilePath); } catch {}
        return null;
    }
}

const deleteFromCloudinary = async (imageUrl) => {
    try {
        if (!imageUrl) return null;

        const regex = /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/;
        const match = imageUrl.match(regex);

        if (!match) {
            console.log("Could not extract publicId from URL:", imageUrl);
            return null;
        }

        const publicId = match[1];
        const agent = cloudinaryAgent();
        const response = await cloudinary.uploader.destroy(publicId, agent ? { agent } : undefined);
        return response;
    } catch (error) {
        console.log("Error deleting from cloudinary:", error);
        return null;
    }
}

export { uploadToCloudinary, deleteFromCloudinary };
