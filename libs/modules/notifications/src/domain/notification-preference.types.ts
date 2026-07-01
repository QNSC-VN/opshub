export interface NotificationPreference {
  id: string;
  userId: string;
  /** '*' = wildcard; specific event type string otherwise. */
  type: string;
  inApp: boolean;
  email: boolean;
  updatedAt: Date;
}

export interface UpsertPreferenceInput {
  userId: string;
  type: string;
  inApp?: boolean;
  email?: boolean;
}

export type NotificationChannel = 'in_app' | 'email';
