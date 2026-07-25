import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { requireAuthenticatedUser } from '~/lib/auth/requireUser';
import {
  BUILDERS_DB_PROJECT_REFUSAL_MESSAGE,
  isBuildersDbProjectId,
} from '~/lib/database-activation/provisioning/buildersDbProjectGuard';

const logger = createScopedLogger('api.supabase.query');

export async function action({ request, context }: ActionFunctionArgs) {
  await requireAuthenticatedUser(request, context);

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  /*
   * `Authorization` here is the caller's own Supabase MANAGEMENT token (forwarded verbatim to
   * api.supabase.com below) — an unrelated, pre-existing use of that header. Never confused
   * with the X-Builders-Auth session header requireAuthenticatedUser() just checked above.
   */
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return new Response('No authorization token provided', { status: 401 });
  }

  try {
    const { projectId, query } = (await request.json()) as any;
    logger.debug('Executing query:', { projectId, query });

    /*
     * Sprint 76 — the ultimate, server-side enforcement of the BuildersDB isolation boundary
     * (docs/backend-activation/Provisioning-Architecture.md §1): this is the one place that
     * actually reaches api.supabase.com, so it's checked here regardless of what any client-side
     * caller (SupabaseProvisioner, or any future caller of this route) already checked.
     */
    if (isBuildersDbProjectId(projectId)) {
      return new Response(JSON.stringify({ error: { message: BUILDERS_DB_PROJECT_REFUSAL_MESSAGE } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;

      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        console.log(e);
        errorData = { message: errorText };
      }

      logger.error(
        'Supabase API error:',
        JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        }),
      );

      return new Response(
        JSON.stringify({
          error: {
            status: response.status,
            statusText: response.statusText,
            message: errorData.message || errorData.error || errorText,
            details: errorData,
          },
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const result = await response.json();

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    logger.error('Query execution error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Query execution failed',
          stack: error instanceof Error ? error.stack : undefined,
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
