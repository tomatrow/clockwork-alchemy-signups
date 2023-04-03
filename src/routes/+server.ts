import { env } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
 
export const GET = (() => {
  return Response.redirect(env.PUBLIC_BASE_URL + "/signup", 302)
}) satisfies RequestHandler;