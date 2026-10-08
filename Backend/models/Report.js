import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
    w: { type: String, required: true },
    c: { type: String, required: true },
    messageId: { type: String, required: true },
    by: { type: String, required: true },
    reason: { type: String, default: '', maxlength: 200 },
}, { timestamps: true });

export default mongoose.model('Report', reportSchema);
