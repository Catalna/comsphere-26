export function requireRole(...roles) {
  const allowed = new Set(roles);
  return function roleGate(request, response, next) {
    if (!request.currentUser || !allowed.has(request.currentUser.role)) {
      return response.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}
