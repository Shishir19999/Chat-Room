import mongoose from 'mongoose';

// One document per chat operation (message, edit, delete, reaction, pin, read marker, channel, group).
// Register-style ops (read markers, channel and group definitions) keep one document per key.
const opSchema = new mongoose.Schema({
    w: { type: String, required: true },
    id: { type: String, required: true },
    c: { type: String, required: true },
    t: { type: String, required: true },
    a: { type: String, required: true },
    lc: { type: Number, required: true },
    ts: { type: Number, required: true },
    d: { type: mongoose.Schema.Types.Mixed, required: true },
    k: { type: String },
}, { versionKey: false, minimize: false });

opSchema.index({ w: 1, id: 1 }, { unique: true });
opSchema.index({ w: 1, c: 1, lc: -1 });
opSchema.index({ w: 1, lc: -1 });
opSchema.index({ w: 1, k: 1 }, { sparse: true });

export default mongoose.model('Op', opSchema);
