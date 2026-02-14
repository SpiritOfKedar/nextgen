import mongoose from 'mongoose';

const generatedFileSchema = new mongoose.Schema({
    filePath: { type: String, required: true },
    content: { type: String, required: true },
}, { _id: false });

const messageSchema = new mongoose.Schema({
    content: { type: String, required: true },           // Display-friendly text (bolt tags stripped)
    rawContent: { type: String, default: '' },            // Original AI response with bolt XML intact
    role: { type: String, enum: ['user', 'assistant'], required: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', required: true, index: true },
    files: { type: [generatedFileSchema], default: [] },  // Extracted code files from this message
    shellCommands: { type: [String], default: [] },        // Shell commands from bolt actions
    createdAt: { type: Date, default: Date.now }
});

export const Message = mongoose.model('Message', messageSchema);
