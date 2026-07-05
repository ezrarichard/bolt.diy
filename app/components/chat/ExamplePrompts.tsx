interface ChipPrompt {
  text: string;
  prompt: string;
}

/**
 * Sprint 24 — each chip's visible label stays short, but clicking it fills
 * the prompt textarea with a fuller starter prompt (bracketed placeholders
 * like [target users] left for the user to edit) rather than sending
 * immediately.
 */
const EXAMPLE_PROMPTS: ChipPrompt[] = [
  { text: 'Build a SaaS', prompt: 'Build a SaaS platform for [target users] that helps them [main outcome].' },
  {
    text: 'E-commerce Store',
    prompt:
      'Build an e-commerce store for [business type] with products, cart, checkout, payments, and order tracking.',
  },
  {
    text: 'Local Business Website',
    prompt:
      'Build a local business website for [business name] with services, contact form, WhatsApp CTA, Google Maps, and SEO.',
  },
  {
    text: 'Restaurant Website',
    prompt: 'Build a restaurant website with menu, online ordering, table booking, offers, and WhatsApp contact.',
  },
  {
    text: 'CRM System',
    prompt: 'Build a CRM system for [industry] with leads, customers, tasks, notes, follow-ups, and dashboard.',
  },
  {
    text: 'Mobile App',
    prompt: 'Build a mobile app for [idea] with onboarding, user login, main screens, notifications, and profile.',
  },
  {
    text: 'AI Assistant',
    prompt: 'Build an AI assistant that helps [users] with [task], including chat, history, and settings.',
  },
  {
    text: 'Admin Dashboard',
    prompt: 'Build an admin dashboard with analytics, user management, reports, filters, and export options.',
  },
];

/**
 * Sprint 24 — clicking a chip fills the prompt textarea via `fillPrompt`
 * (never sends). The caller (BaseChat.tsx) wires this to
 * handleInputChange + a textarea focus, the same pattern already used for
 * the speech-recognition transcript.
 */
export function ExamplePrompts(fillPrompt?: (prompt: string) => void) {
  return (
    <div id="examples" className="relative flex flex-col gap-9 w-full max-w-3xl mx-auto flex justify-center mt-6">
      <div
        className="flex flex-wrap justify-center gap-2"
        style={{
          animation: '.25s ease-out 0s 1 _fade-and-move-in_g2ptj_1 forwards',
        }}
      >
        {EXAMPLE_PROMPTS.map((examplePrompt, index: number) => {
          return (
            <button
              key={index}
              onClick={() => fillPrompt?.(examplePrompt.prompt)}
              className="border border-bolt-elements-borderColor rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-gray-950 dark:hover:bg-gray-900 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary px-3 py-1 text-xs transition-theme"
            >
              {examplePrompt.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
