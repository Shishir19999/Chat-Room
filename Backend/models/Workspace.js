import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, maxlength: 30 },
    isPrivate: { type: Boolean, default: false },
    salt: { type: String },
    hash: { type: String },
    createdBy: { type: String, default: '' },
    lastAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('Workspace', workspaceSchema);
