import mongoose from 'mongoose';

const threadFileSchema = new mongoose.Schema({
    filePath: { type: String, required: true },
    content: { type: String, required: true },
}, { _id: false });

const threadSchema = new mongoose.Schema({
    title: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Latest consolidated snapshot of all generated files across all messages in this thread
    files: { type: [threadFileSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const Thread = mongoose.model('Thread', threadSchema);
