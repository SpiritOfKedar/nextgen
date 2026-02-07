import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    clerkId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model('User', userSchema);
