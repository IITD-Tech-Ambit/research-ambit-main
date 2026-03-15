import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    body: {
      type: String,
      required: true,
      trim: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null implies anonymous
    },
    ip_address: {
      type: String,
      required: true,
    },
    likes: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        ip_address: {
          type: String,
          required: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const analyticsSchema = new mongoose.Schema(
  {
    content: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content',
      required: true,
      unique: true,
    },
    likes: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        ip_address: {
          type: String,
          required: true,
        },
      },
    ],
    comments: [commentSchema],
  },
  {
    timestamps: true,
  }
);

analyticsSchema.index({ 'likes.user': 1, 'likes.ip_address': 1 }); // Optimize lookups
analyticsSchema.index({ 'comments.created_by': 1 }); // Optimize comment user lookups
analyticsSchema.index({ 'comments.ip_address': 1 }); // Optimize comment IP lookups

const Analytics = mongoose.model('Analytics', analyticsSchema);

export default Analytics;
