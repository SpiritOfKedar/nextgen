import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    content: { type: String, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', required: true, index: true },
    createdAt: { type: Date, default: Date.now }
});

export const Message = mongoose.model('Message', messageSchema);
