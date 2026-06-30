export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full">
        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Clarity API Server</h1>
        <p className="text-slate-500 mb-6">Backend systems are online and running.</p>
        <div className="flex flex-col gap-3">
          <a href="/admin" className="block w-full bg-indigo-600 text-white font-medium py-2.5 rounded-lg hover:bg-indigo-700 transition-colors">
            Go to Admin Dashboard
          </a>
          <a href="http://localhost:3001" className="block w-full bg-white text-slate-700 border border-slate-300 font-medium py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
            View Public Frontend
          </a>
        </div>
      </div>
    </main>
  );
}
