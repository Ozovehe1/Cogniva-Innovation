export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white">GeniusMap</h1>
          <p className="text-purple-300 mt-2">Every Student is a Genius — AI Finds the Proof</p>
        </div>
        {children}
      </div>
    </div>
  )
}
