/**
 * Template Resolver — Sprint 38.
 *
 * A registry of project templates keyed by id, designed for extension: adding Next.js/
 * React Native/Node API/Shopify later means adding one more registry entry (and its own
 * scaffolder implementation) — nothing about generationPipeline.ts or
 * webcontainerWriter.ts needs to change to support a new template, since both only ever
 * deal in the template-agnostic `GeneratedFile[]`/`GeneratedProject` shapes.
 *
 * Only one high-quality path is implemented this sprint — React + Vite + TypeScript —
 * per the sprint's own "Do not attempt to support every framework" instruction.
 */

export interface ProjectTemplate {
  id: string;
  label: string;

  /** Package name/version pairs merged into the generated package.json's "dependencies". */
  dependencies: Record<string, string>;

  /** Package name/version pairs merged into the generated package.json's "devDependencies". */
  devDependencies: Record<string, string>;
}

export const REACT_VITE_TS_TEMPLATE_ID = 'react-vite-ts';

const TEMPLATES: Record<string, ProjectTemplate> = {
  [REACT_VITE_TS_TEMPLATE_ID]: {
    id: REACT_VITE_TS_TEMPLATE_ID,
    label: 'React + Vite + TypeScript',
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'react-router-dom': '^6.26.2',
    },
    devDependencies: {
      typescript: '^5.5.4',
      vite: '^5.4.8',
      '@vitejs/plugin-react': '^4.3.2',
      '@types/react': '^18.3.11',
      '@types/react-dom': '^18.3.1',
    },
  },
};

/** Falls back to the React/Vite/TS template for any unknown/missing id — never throws, since an unrecognized template id should degrade to "the one high-quality path" rather than block generation. */
export function resolveTemplate(templateId?: string): ProjectTemplate {
  return (templateId && TEMPLATES[templateId]) || TEMPLATES[REACT_VITE_TS_TEMPLATE_ID];
}

export function listTemplates(): ProjectTemplate[] {
  return Object.values(TEMPLATES);
}
