export type UserRole = 'student' | 'tutor'

export interface Profile {
  id: string
  user_id: string
  full_name: string
  email: string
  role: UserRole
  avatar_url?: string
  created_at: string
}
