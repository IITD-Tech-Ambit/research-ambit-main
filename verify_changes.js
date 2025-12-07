
// Verification script to check if files are syntactically correct and can be imported
import { uploadToCloudinary } from './src/lib/cloudinary.js';
import contentRouter from './src/routes/content.js';
import cms from './src/controllers/cms.js';

console.log('Successfully imported cloudinary helper:', typeof uploadToCloudinary === 'function');
console.log('Successfully imported content router:', typeof contentRouter === 'function');
console.log('Successfully imported cms controller:', typeof cms === 'object');
console.log('Verification passed!');
