import mongoose from 'mongoose';

const threadSchema = new mongoose.Schema({
    title: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const Thread = mongoose.model('Thread', threadSchema);
