import { SESSION_COOKIE_NAME } from "../auth/sessionConstants.js";

export function createSessionMiddleware(authService) {
  return async function loadSession(request, response, next) {
    try {
      const user = await authService.loadSessionUser(request.cookies?.[SESSION_COOKIE_NAME]);
      if (!user) return response.status(401).json({ error: "authentication_required" });
      request.currentUser = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
