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

export interface IntelligenceScores {
  linguistic: number
  logicalMathematical: number
  spatial: number
  musical: number
  bodilyKinesthetic: number
  interpersonal: number
  intrapersonal: number
  naturalist: number
}

export interface IntelligenceProfile {
  id: string
  student_id: string
  dominant_intelligence: string
  intelligence_scores: IntelligenceScores
  personality_insight: string
  learning_path: string[]
  career_suggestions: string[]
  study_tips: string[]
  genius_statement: string
  created_at: string
  updated_at: string
}

export interface StudentGrowth {
  id: string
  student_id: string
  growth_score: number
  projects_completed: number
  projects_total: number
  level: string
  badges: string[]
  updated_at: string
}

export interface TutorStudent {
  id: string
  tutor_id: string
  student_id: string
  created_at: string
  student?: Profile
}

export interface Project {
  id: string
  tutor_id: string
  title: string
  description: string
  subject: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  objectives: string[]
  steps: string[]
  deliverables: string[]
  estimated_hours: number
  intelligence_activated: string[]
  ai_generated?: boolean
  created_at: string
}

export interface ProjectAssignment {
  id: string
  project_id: string
  student_id: string
  status: 'assigned' | 'in_progress' | 'pending_review' | 'completed'
  submitted_at?: string
  feedback?: string | null
  created_at: string
  project?: Project
}

export interface AssessmentQuestion {
  id: number
  text: string
  intelligenceType: keyof IntelligenceScores
  options: { label: string; value: number }[]
}
