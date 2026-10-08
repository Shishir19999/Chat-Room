import mongoose from 'mongoose';

// Attachments live in MongoDB (limit 5 MB each, well under the 16 MB document cap) and expire after 60 days.
const uploadSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    w: { type: String, required: true },
    by: { type: String, required: true },
    name: { type: String, required: true, maxlength: 120 },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    at: { type: Date, default: Date.now, expires: 60 * 24 * 3600 },
}, { versionKey: false });

export default mongoose.model('Upload', uploadSchema);
