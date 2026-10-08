import mongoose from 'mongoose';

// Simple identity binding: the first connection with a user id stores a hash of its secret, later joins must match.
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    secretHash: { type: String, required: true },
    name: { type: String, default: '' },
    lastAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
