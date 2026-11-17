import mongoose from 'mongoose';

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskChecklistItem = {
  _id: mongoose.Types.ObjectId;
  text: string;
  done: boolean;
};

export type TaskComment = {
  _id: mongoose.Types.ObjectId;
  username: string;
  authorName: string;
  text: string;
  createdAt: Date;
};

export type TaskActivity = {
  username: string;
  action: string;
  detail: string;
  at: Date;
};

export type TaskDoc = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Usernames of the people responsible for the task. */
  assignees: string[];
  department: string;
  labels: string[];
  createdBy: string;
  createdByName: string;
  startDate?: Date;
  dueDate?: Date;
  completedAt?: Date;
  /** Position inside its status column on the Kanban board (lower = higher up). */
  order: number;
  checklist: TaskChecklistItem[];
  comments: TaskComment[];
  activity: TaskActivity[];
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const checklistSchema = new mongoose.Schema<TaskChecklistItem>({
  text: { type: String, required: true, trim: true },
  done: { type: Boolean, default: false },
});

const commentSchema = new mongoose.Schema<TaskComment>({
  username: { type: String, required: true },
  authorName: { type: String, default: '' },
  text: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: () => new Date() },
});

const activitySchema = new mongoose.Schema<TaskActivity>(
  {
    username: { type: String, required: true },
    action: { type: String, required: true },
    detail: { type: String, default: '' },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema<TaskDoc>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    status: { type: String, enum: TASK_STATUSES, default: 'todo', index: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    assignees: { type: [String], default: [], index: true },
    department: { type: String, default: '', trim: true },
    labels: { type: [String], default: [] },
    createdBy: { type: String, required: true, index: true },
    createdByName: { type: String, default: '' },
    startDate: { type: Date },
    dueDate: { type: Date },
    completedAt: { type: Date },
    order: { type: Number, default: 0 },
    checklist: { type: [checklistSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
    archived: { type: Boolean, default: false, index: true },
  },
  { collection: 'tasks', timestamps: true }
);

taskSchema.index({ archived: 1, status: 1, order: 1 });
taskSchema.index({ dueDate: 1 });

export const TaskModel = mongoose.model<TaskDoc>('Task', taskSchema);
