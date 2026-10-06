import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
    user: { type: String, required: true, trim: true, maxlength: 30 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    room: { type: String, default: 'general', index: true },
    timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

export default ChatMessage;
