import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
    user: { type: String, required: true, trim: true, maxlength: 30 },
    message: { type: String, trim: true, maxlength: 500, default: '' },
    room: { type: String, default: 'general', index: true },
    // Optional image attachment as a size-limited data URL.
    image: { type: String, maxlength: 400000 },
    // Snapshot of the message being replied to.
    replyTo: {
        _id: { type: mongoose.Schema.Types.ObjectId },
        user: { type: String, maxlength: 30 },
        message: { type: String, maxlength: 140 },
    },
    reactions: { type: [new mongoose.Schema({ emoji: String, users: [String] }, { _id: false })], default: [] },
    editedAt: { type: Date },
    deleted: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

export default ChatMessage;
