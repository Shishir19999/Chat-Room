import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, maxlength: 30 },
    description: { type: String, trim: true, maxlength: 80, default: '' },
    createdBy: { type: String, trim: true, maxlength: 30, default: '' },
}, { timestamps: true });

export default mongoose.model('Room', roomSchema);
