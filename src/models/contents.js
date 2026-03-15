import mongoose from 'mongoose';

const contentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
    },
    image_url: {
      type: String,
      default: '',
    },
    body: {
      type: String,
      required: true,
      // Markdown content
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'archived', 'online'],
      default: 'pending',
    },
    est_read_time: {
      type: Number, // in minutes
      default: 0,
    },
    is_approved: {
      type: Boolean,
      default: false,
    },
    analytics: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Analytics',
    },
  },
  {
    timestamps: true,
  }
);

contentSchema.index({ status: 1 }); // Optimize status queries
contentSchema.index({ created_by: 1 }); // Optimize user content lookups

const Content = mongoose.model('Content', contentSchema);

export default Content;
