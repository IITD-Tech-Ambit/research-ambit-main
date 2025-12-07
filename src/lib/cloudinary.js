import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadToCloudinary = async (localFilePath, folder) => {
    try {
        if (!localFilePath) return null;

        // Upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
            folder: folder
        });

        // file has been uploaded successfull
        // console.log("file is uploaded on cloudinary ", response.url);
        fs.unlinkSync(localFilePath);
        return response.url;
    } catch (error) {
        fs.unlinkSync(localFilePath); // remove the locally saved temporary file as the upload operation got failed
        return null;
    }
}

const deleteFromCloudinary = async (imageUrl) => {
    try {
        if (!imageUrl) return null;

        // Extract publicId from url
        // URL format: https://res.cloudinary.com/cloud_name/image/upload/v12345678/folder/filename.extension
        const regex = /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/;
        const match = imageUrl.match(regex);

        if (!match) {
            console.log("Could not extract publicId from URL:", imageUrl);
            return null;
        }

        const publicId = match[1];

        // Delete the file from cloudinary
        const response = await cloudinary.uploader.destroy(publicId);
        return response;
    } catch (error) {
        console.log("Error deleting from cloudinary:", error);
        return null;
    }
}

export { uploadToCloudinary, deleteFromCloudinary };
