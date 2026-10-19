import mongoose from 'mongoose';

const profileUpdateNoticeSchema = new mongoose.Schema(
    {
        kerberos: { type: String, required: true },
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        status: {
            type: String,
            enum: ['pending', 'sending', 'retry', 'sent', 'skipped', 'failed'],
            default: 'pending',
        },
        baseline: { type: mongoose.Schema.Types.Mixed, default: {} },
        latest: { type: mongoose.Schema.Types.Mixed, default: {} },
        actors: [{ _id: false, kind: { type: String, enum: ['self', 'superadmin'] }, id: String }],
        firstChangeAt: Date,
        lastChangeAt: Date,
        sendAfter: Date,
        leaseUntil: Date,
        attempts: { type: Number, default: 0 },
        lastError: String,
        recipient: String,
        messageId: String,
        sentAt: Date,
        expireAt: Date,
    },
    { minimize: false, timestamps: true },
);

profileUpdateNoticeSchema.index(
    { kerberos: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } },
);
profileUpdateNoticeSchema.index({ status: 1, sendAfter: 1 });
profileUpdateNoticeSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const ProfileUpdateNotice = mongoose.model(
    'ProfileUpdateNotice',
    profileUpdateNoticeSchema,
    'profile_update_notices',
);

export default ProfileUpdateNotice;
