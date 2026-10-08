import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createChatServer } from './app.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // reachable from other devices on the LAN

mongoose.connect(process.env.MONGODB_URL).then(async () => {
    await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes (unique op ids) up front
    console.log('Connected to MongoDB');
}).catch((error) => {
    console.error('Error connecting to MongoDB:', error.message);
});

const { server } = createChatServer();
server.listen(PORT, HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
});
