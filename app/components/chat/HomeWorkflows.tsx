import { requestNewProjectDialog } from '~/lib/stores/projects';

/**
 * Builders Software Factory — home hero (Phase 1).
 *
 * Builders now exposes exactly ONE workflow: the Software Factory. The user describes a
 * business problem and an AI engineering team (Business Analyst → Solution Architect →
 * UI/UX → Frontend → Backend → Database → QA → DevOps → Project Manager) turns it into
 * requirements, a working prototype, and a deployable app — the user only reviews,
 * approves, and deploys.
 *
 * The single call-to-action opens the existing New Project dialog (requestNewProjectDialog,
 * ~/lib/stores/projects), which always creates a `guided_engineering` project — see
 * NewProjectDialog.tsx. Nothing here generates anything or calls an LLM.
 *
 * Phase 1 removed the previous four-card grid (Quick Build / Guided Engineering / two
 * "Coming Soon" placeholders) and the inline Quick Build prompt box. Quick Build is frozen
 * and no longer creatable from the Builders surface; its code is untouched and existing
 * Quick Build projects remain openable from the sidebar/recent lists.
 */

const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_091828_e240eb17-6edc-4129-ad9d-98678e3fd238.mp4';

/** The AI engineering roles, shown as a pipeline so the home immediately reads as "a software company", not a code editor. */
const FACTORY_ROLES = [
  'Business Analyst',
  'Solution Architect',
  'UI/UX Designer',
  'Frontend',
  'Backend',
  'Database',
  'QA',
  'DevOps',
  'Project Manager',
];

export function HomeWorkflows() {
  return (
    <div
      className="relative min-h-screen shrink-0 bg-gray-950 overflow-hidden -mx-4 lg:mx-0"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <video
        autoPlay
        muted
        loop
        playsInline
        crossOrigin="anonymous"
        className="absolute inset-0 w-full h-full object-cover"
        src={HERO_VIDEO_URL}
      />
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-purple-950/20 to-black/70" />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top nav — brand only; this is an app homepage, not a marketing site */}
        <div className="max-w-7xl mx-auto w-full px-8 py-6 flex items-center justify-between">
          <span className="text-white font-semibold tracking-tight">Builders</span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-purple-200/80 border border-purple-300/30 rounded-full px-3 py-1">
            AI Software Factory
          </span>
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center text-center py-8 pb-16">
          <div className="max-w-3xl mx-auto px-8 w-full">
            <div className="text-sm uppercase tracking-wider text-purple-200/80 mb-4">Builders Software Factory</div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-white mb-4">
              Describe the problem.
              <br />
              <span className="text-purple-300">Your AI team builds the product.</span>
            </h1>
            <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto mb-8">
              A complete AI engineering team turns your idea into requirements, a working prototype, and a deployable
              app. You provide the business vision, the approvals, and the customer relationship — the team does the
              engineering.
            </p>

            <button
              type="button"
              onClick={requestNewProjectDialog}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-base font-semibold bg-purple-500 text-white hover:bg-purple-600 transition-colors shadow-lg shadow-purple-900/30"
            >
              Start a Project
              <span className="i-ph:arrow-right w-4.5 h-4.5" />
            </button>

            {/* The engineering pipeline, so the user sees the "software company" they're hiring. */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
              {FACTORY_ROLES.map((role, index) => (
                <div key={role} className="flex items-center gap-2">
                  <span className="text-[11px] md:text-xs font-medium text-white/75 bg-white/10 border border-white/15 rounded-full px-3 py-1 backdrop-blur-md">
                    {role}
                  </span>
                  {index < FACTORY_ROLES.length - 1 && (
                    <span className="i-ph:arrow-right w-3 h-3 text-purple-200/50 hidden sm:inline-block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
